// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
// from https://github.com/superfluid-finance/superfluid-protocol-preview/blob/c6fa78403d72878d2dfc626998ca1fbcb954fb99/ethereum-contracts/contracts/test/TestToken.sol
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Test ERC20 token that allows any one mint new tokens.
 */
contract TestToken is ERC20 {

    constructor(string memory name, string memory symbol)
        /* solhint-disable-next-line no-empty-blocks */ // BUG from solhint?
        ERC20(symbol, name) {
    }

    /**
     * @dev See {ERC20-_mint}.
     */
    function mint(address account, uint256 amount) public returns (bool) {
        ERC20._mint(account, amount);
        return true;
    }

}