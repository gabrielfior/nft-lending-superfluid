// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MintableNFT is ERC721 {

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_){}

    function safeMint(address to, uint256 tokenId) public {
        _safeMint(to, tokenId);
    }
}