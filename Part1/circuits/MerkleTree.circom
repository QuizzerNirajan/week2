pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    var end = 2 * 2**n  - 1;
    var hashList[end];
    component poseidon[2**n];

    // hashList initialization with the leaves
    for (var k = 0; k < 2**n; k++) 
    {
        hashList[k] = leaves[k];
    }

    /// Compute parent's hash and store in the hashList
    for (var k = 0; k < 2**n-1; k++) {
        poseidon[k] = Poseidon(2);

        // store the left and right leaf in the poseidon hash input
        poseidon[k].inputs[1] <-- hashList[2*k+1];
        poseidon[k].inputs[0] <-- hashList[2*k];
        hashList[k + 2**n] = poseidon[k].out;
    }

    root <== hashList[2 * 2**n - 2];
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path
    
    // define hash compoenent
    component poseidon[n];

    // assign current hash to the leaf
    var presentHash = leaf;

    // Calculate the parent's hash upto the root
    for (var k = 0; k < n; k++) {
        poseidon[k] = Poseidon(2); // initialize the Poseidon component

        // assign to present leaf is the element is left, otherwise assign to presentHash
        poseidon[k].inputs[0] <-- path_index[k] ? path_elements[k] : presentHash; 
        poseidon[k].inputs[1] <-- path_index[k] ? presentHash : path_elements[k];

        // store the computed parent hash to present hash
        presentHash = poseidon[k].out;
    }
    // the final hash is that of the root
    root <== presentHash;
}