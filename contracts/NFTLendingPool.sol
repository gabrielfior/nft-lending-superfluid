// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ISuperAgreement, SuperAppDefinitions, ISuperfluid, ISuperToken, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {SuperTokenV1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import "./NFTChest.sol";

// errors

/// @dev Thrown when the callback caller is not the host.
error Unauthorized();

/// @dev Thrown when the token being streamed to this contract is invalid
error InvalidToken();

/// @dev Thrown when the agreement is other than the Constant Flow Agreement V1
error InvalidAgreement();

contract NFTLendingPool is IERC721Receiver, SuperAppBase {
    ERC721 public nft;
    NFTChest public nftChest;
    int8 public immutable interestRate;
    // ToDo - add owner
    /// @notice Total amount borrowed.
    int256 public borrowAmount;
    uint256 public tokenId; // set when collateral is deposited
    int256 public maxBorrowAmount = 1000 * (10**18);
    address borrower;

    using SuperTokenV1Library for ISuperToken;

    /// @dev Super token that may be streamed to this contract
    ISuperToken internal immutable acceptedToken;
    ERC20 internal immutable underlyingToken;

    ///@notice this is the superfluid host which is used in modifiers
    ISuperfluid immutable host;

    IConstantFlowAgreementV1 immutable cfa;

    constructor(
        ERC721 _nft,
        int8 _interestRate, // annual interest rate, in whole number - i.e. 8% would be passed as 8
        ISuperfluid _host,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken _acceptedToken,
        ERC20 _underlyingToken
    ) {
        nft = _nft;
        nftChest = new NFTChest();
        interestRate = _interestRate;
        acceptedToken = _acceptedToken;
        underlyingToken = _underlyingToken;
        host = _host;
        cfa = _cfa;

        // super app registration
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL |
            SuperAppDefinitions.BEFORE_AGREEMENT_TERMINATED_NOOP;

        _host.registerApp(configWord);
    }

    // modifiers
    modifier onlyHost() {
        if (msg.sender != address(host)) revert Unauthorized();
        _;
    }

    modifier onlyExpected(ISuperToken superToken, address agreementClass) {
        if (superToken != acceptedToken) revert InvalidToken();
        if (agreementClass != address(cfa)) revert InvalidAgreement();
        _;
    }

    // Inspired by Superfluid's EmploymentLoan.sol
    function getPaymentFlowRate() public view returns (int96 paymentFlowRate) {
        return int96((borrowAmount * int256(interestRate)) / int256(100));
    }

    function depositCollateral(uint256 _tokenId) public {
        tokenId = _tokenId;
        //nft.setApprovalForAll(address(this), true);
        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        borrower = msg.sender;
    }

    function borrowAgainstCollateral(int256 amount) public {
        require(amount < maxBorrowAmount);
        require(msg.sender == borrower);
        int96 borrowerFlowRate = acceptedToken.getFlowRate(
            msg.sender,
            address(this)
        );

        require(borrowerFlowRate == 0, "Borrower flow rate should be 0");
        require(
            underlyingToken.transfer(msg.sender, uint256(amount)),
            "Token transfer not successful"
        );

        borrowAmount += amount;
        int96 flowRate = getPaymentFlowRate();
        acceptedToken.createFlowFrom(msg.sender, address(this), flowRate);
    }

    function repay(int256 amount) public {
        require(amount < maxBorrowAmount);
        require(
            underlyingToken.transferFrom(
                msg.sender,
                address(this),
                uint256(amount)
            ),
            "Token transfer not successful"
        );

        // Update borrowAmount
        borrowAmount -= amount;

        // ToDo - Update flow rate correctly
        int96 flowRate = getPaymentFlowRate();

        if (flowRate == 0) {
            acceptedToken.deleteFlowFrom(msg.sender, address(this));
            nft.safeTransferFrom(address(this), msg.sender, tokenId);
        } else {
            acceptedToken.updateFlowFrom(msg.sender, address(this), flowRate);
        }
    }

    function liquidateUser() private {
        nft.safeTransferFrom(address(this), address(nftChest), tokenId);
        // We also erase the debt since the NFT has been sized."forgive" the debt.
        borrowAmount = 0;
    }

    // ---------------------------------------------------------------------------------------------
    // SUPER APP CALLBACKS
    function beforeAgreementCreated(
        ISuperToken, /*superToken*/
        address, /*agreementClass*/
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx /*ctx*/
    )
        external
        view
        virtual
        override
        returns (
            bytes memory /*cbdata*/
        )
    {
        //revert("Unsupported callback - Before Agreement Created");
        return _ctx;
    }

    function beforeAgreementUpdated(
        ISuperToken, /*superToken*/
        address, /*agreementClass*/
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx /*ctx*/
    )
        external
        view
        virtual
        override
        returns (
            bytes memory /*cbdata*/
        )
    {
        return _ctx;
    }

    function beforeAgreementTerminated(
        ISuperToken, /*superToken*/
        address, /*agreementClass*/
        bytes32, /*agreementId*/
        bytes calldata, /*agreementData*/
        bytes calldata _ctx /*ctx*/
    )
        external
        view
        virtual
        override
        returns (
            bytes memory /*cbdata*/
        )
    {
        return _ctx;
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId
        bytes calldata, //_agreementData
        bytes calldata, //_cbdata
        bytes calldata _ctx
    ) external view override onlyHost returns (bytes memory newCtx) {
        return _ctx;
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // _agreementData,
        bytes calldata, // _cbdata,
        bytes calldata _ctx
    )
        external
        view
        override
        onlyExpected(_superToken, _agreementClass)
        onlyHost
        returns (bytes memory newCtx)
    {
        return _ctx;
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, // _agreementId,
        bytes calldata, // _agreementData
        bytes calldata, // _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        liquidateUser();
        return _ctx;
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
