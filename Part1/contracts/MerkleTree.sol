//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import {PoseidonT3} from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    // define the total number of leaves and level
    uint16 private num_leaves;
    uint16 private levels;

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        num_leaves = 8;
        levels = 3;

        hashes = new uint256[](num_leaves * 2 - 1);
        for (uint256 k = 0; k < num_leaves; k++) 
        {
            hashes[k] = 0;
        }

        for (uint256 k = 0; k < num_leaves - 1; k++) {
            hashes[k + num_leaves] = PoseidonT3.poseidon
            (
                [hashes[2 * k], hashes[2 * k + 1]]
            );
        }

        root = hashes[hashes.length - 1];
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree

        // set the hashedLeaf to the hashes array
        hashes[index] = hashedLeaf;

        // Not optimal to compute the entire merkel tree, so set the hashes as we move towards the root
        uint initial = 0; // start at the leftmost leaf
        uint move = index; // move towards the given index

        for (uint k = 1; k < num_leaves; k *= 2) 
        {
            uint cur = initial + move; // curent is the summ of the move and offset
            initial += num_leaves / k;
            move /= 2;

            if(cur % 2 == 0)
            {
                hashes[initial + move] = PoseidonT3.poseidon([hashes[cur], hashes[cur + 1]]);
            }
            else
            {
                hashes[initial + move] = PoseidonT3.poseidon([hashes[cur - 1], hashes[cur]]);
            }
        }

        index++; // increment the index
        root = hashes[hashes.length - 1]; // root is the final element of the hash array
        return root; // return the root
    }

    function verify(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[1] memory input
    ) public view returns (bool) {
        // [assignment] verify an inclusion proof and check that the proof root matches current root
           return Verifier.verifyProof(a, b, c, input);
    }
}
