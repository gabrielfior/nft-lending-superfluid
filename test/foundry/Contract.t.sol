// SPDX-License-Identifier: Unlicense
pragma solidity >=0.6.0;

import "forge-std/Test.sol";


contract TestFallout is Test {

    uint a;

    constructor() public {

    }

    function setUp() public override {
        // Call the BaseTest setUp() function that will also create testsing accounts
        a = 2;
    }

    function testRunLevel() public {

    }
}