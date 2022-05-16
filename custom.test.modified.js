const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000')) // approve for deposit

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig } // return all the contracts
  }

  /// Function to check the account balance
  async function findBalance(tornadoPool, keypair) {
    // Detect incoming funds
    const refine = tornadoPool.filters.NewCommitment() // create a new commitment
    const thisBlock = await ethers.provider.getBlock() // get the current block
    const event = await tornadoPool.queryFilter(refine, thisBlock.number) // get the event from the filter
    let utxoReceive
    try {
      utxoReceive = Utxo.decrypt(keypair, event[0].args.encryptedOutput, event[0].args.index) // decrypt the output
    } catch (e) {
      utxoReceive = Utxo.decrypt(keypair, event[1].args.encryptedOutput, event[1].args.index)
    }
    return utxoReceive.amount
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
    //store public key and private key of Alice
    const aliceKey = new Keypair()

    // Alice deposits 0.1ETH into tornado pool--L1
    const aliceDepositETHAmount = utils.parseEther('0.1')
    //generate Utxo tokens
    const aliceDepositUtxo = new Utxo({ amount: aliceDepositETHAmount, keypair: aliceKey })

    // prepare the transaction
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    }) 

    // encode the data for the bridge
    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    }) 

    // create a transaction to deposit 0.1ETH
    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      aliceDepositUtxo.amount,
      onTokenBridgedData,
    ) 
    // emulating the bridge which first sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositETHAmount)
    const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositETHAmount) // transfer to tornado pool

    // send tokens to pool
    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ]) 

    // 0.08 ETH is withdrawn by Alice from the shielded pool
    const aliceWithdrawAmount = utils.parseEther('0.08') // 0.08ETH
    const recipient = '0xDeaD00000000000000000000000000000000BEEf' // hex recipent address
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositETHAmount.sub(aliceWithdrawAmount), //this subtracts amount from alice account which also requires alice keyPairs
      keypair: aliceKey,
    })
    await transaction({
      //this transaction takes aliceDepositUtxo as input because action to be performed is deposit by alice
      tornadoPool, //and outputs the chnage as done by aliceChangeUtxo
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: true,
    })

    //previously receipent amount must be zero
    const receivedAmount = await token.balanceOf(recipient) //check the balance of the recipient
    expect(receivedAmount).to.be.equal(0) //assert that the balance of the recipient is zero
    

    const omniBridgeBalance = await token.balanceOf(omniBridge.address) //check the balance of omniBridge
    expect(omniBridgeBalance).to.be.equal(aliceWithdrawAmount)  //assert that the balance of omniBridge is equal to aliceWithdrawAmount
  })

  it('[assignment] iii. deposit 0.13 ETH to L1 -> send 0.06 ETH to Bob -> withdraw from L1 and L2', async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture) // load the fixture
    const aliceKey = new Keypair() // generate key pair for Alice

    // Alice deposits into L1 tornado pool
    const aliceDepositETH = utils.parseEther('0.13') // Alice deposits 0.13 ETH
    const aliceUTXO = new Utxo({ amount: aliceDepositETH, keypair: aliceKey })
    await transaction({ tornadoPool, outputs: [aliceUTXO] })
    expect(await findBalance(tornadoPool, aliceKey)).to.be.equal(aliceDepositETH)

    // Alic transfers funds to BOB in L2
    const bobKeypair = new Keypair() // generate key pair for Bob
    const bobTransferAmount = utils.parseEther('0.06') // set BOB's ether to 0.06
    const bobTransferUTXO = new Utxo({
      amount: bobTransferAmount,
      keypair: Keypair.fromString(bobKeypair.address()),
    })
    const changedAliceUTXO = new Utxo({ amount: aliceDepositETH.sub(bobTransferAmount), keypair: aliceKey })
    const { args, extData } = await prepareTransaction({
      tornadoPool,
      inputs: [aliceUTXO],
      outputs: [bobTransferUTXO, changedAliceUTXO],
    })

    // encode the data for transcation to the bridge
    const onTokenBridge = encodeDataForBridge({ proof: args, extData })
    const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
      token.address,
      bobTransferAmount,
      onTokenBridge,
    )
    // Emulate the bridge by sending to the omniBridge block and to the pool
    await token.transfer(omniBridge.address, bobTransferAmount)

    // populate the transaction
    const transferTxValue = await token.populateTransaction.transfer(tornadoPool.address, bobTransferAmount)

    // execute the omniBridge
    await omniBridge.execute([
      { who: token.address, callData: transferTxValue.data }, // transfer token to the Tornado pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data },
    ])

    // Remaining ETH with Alice = 0.07 ETH , and Bob = 0.06 ETH
    expect(await findBalance(tornadoPool, aliceKey)).to.be.equal(aliceDepositETH.sub(bobTransferAmount))
    expect(await findBalance(tornadoPool, bobKeypair)).to.be.equal(bobTransferAmount)

    /// All remaining funds in L1 is withdraw by Alice
    const aliceETHWithdraw = aliceDepositETH.sub(bobTransferAmount)
    const aliceUTXOWithdraw = new Utxo({ amount: aliceETHWithdraw, keypair: aliceKey }) // new UTXO instant with aliceDepositETH amount
    await transaction({
      tornadoPool,
      inputs: [changedAliceUTXO],
      outputs: [aliceUTXOWithdraw],
      isL1Withdrawal: true,
    })
    expect(await findBalance(tornadoPool, aliceKey)).to.be.equal(aliceETHWithdraw) // Alice gets her remaining ETH

    // All his funds in L2 is withdrawn by Bob
    const bobWithdrawUtxo = new Utxo({ amount: bobTransferAmount, keypair: bobKeypair })
    await transaction({
      tornadoPool,
      outputs: [bobWithdrawUtxo],
      isL1Withdrawal: false,
    })
    // BRemaining ETH with Bob = 0.06 ETH
    expect(await findBalance(tornadoPool, bobKeypair)).to.be.equal(bobTransferAmount)

    // L1 omniBrdige must be empty(0)
    const balanceOmniBridge = await token.balanceOf(omniBridge.address)
    expect(balanceOmniBridge).to.be.equal(0)
  })
})
