// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import {ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {SuperTokenV1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol";
import {ISuperfluid, ISuperToken, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";
import "./NFTChest.sol";
import "hardhat/console.sol";

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
    uint256 public loanStartTime;

    /// @notice Number of months the loan will be paid back in. I.e. 2 years = '24'
    int256 public immutable paybackMonths;
    using SuperTokenV1Library for ISuperToken;

    /// @dev Super token that may be streamed to this contract
    ISuperToken internal immutable acceptedToken;

    ERC20 internal immutable underlyingToken;

    // ToDo - Check if needed
    ///@notice this is the superfluid host which is used in modifiers
    ISuperfluid immutable host;

    IConstantFlowAgreementV1 immutable cfa;

    constructor(
        ERC721 _nft,
        int8 _interestRate, // annual interest rate, in whole number - i.e. 8% would be passed as 8
        int256 _paybackMonths, // total payback months
        ISuperfluid _host,
        IConstantFlowAgreementV1 _cfa,
        ISuperToken _acceptedToken,
        ERC20 _underlyingToken
    ) {
        // apr in pct points, e.g. 10% == 10
        nft = _nft;
        nftChest = new NFTChest();
        interestRate = _interestRate;
        paybackMonths = _paybackMonths;
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

    // Source - Superfluid's EmploymentLoan.sol
    function getPaymentFlowRate() public view returns (int96 paymentFlowRate) {
        return (
            int96(
                ((borrowAmount +
                    ((borrowAmount * int256(interestRate)) / int256(100))) /
                    paybackMonths) / ((365 / 12) * 86400)
                //365/12 = average days in a month; 86400 = seconds in a day (24 hours); -> 365/12 * 86400 average seconds in a month
            )
        );
    }

    // Source - Superfluid's EmploymentLoan.sol
    function getTotalAmountRemaining() public view returns (uint256) {
        //if there is no time left on loan, return zero
        int256 secondsLeft = (paybackMonths * int256((365 * 86400) / 12)) -
            int256(block.timestamp - loanStartTime);
        if (secondsLeft <= 0) {
            return 0;
        } else {
            //if an amount is left, return the total amount to be paid
            return uint256(secondsLeft) * uint256(int256(getPaymentFlowRate()));
        }
    }

    function depositCollateral(uint256 tokenId) public {
        nft.safeTransferFrom(msg.sender, address(this), tokenId);
    }

    function borrowAgainstCollateral(int256 amount) public {
        // ToDo - See https://github.com/superfluid-finance/super-examples/blob/main/projects/borrow-against-salary/contracts/EmploymentLoan.sol
        
        // ToDo - Calculate flow rate
        //int96 flowRate = amount;
        //So if you took out a 100 DAI loan and the APR is 10%, then a stream of 10 DAI/year would be started from your account to the NFT Lending contract.

        int96 borrowerFlowRate = acceptedToken.getFlowRate(
            msg.sender,
            address(this)
        );
        
        require(borrowerFlowRate == 0, "Borrower flow rate should be 0");
        
        // see https://github.com/superfluid-finance/super-examples/blob/main/projects/borrow-against-salary/contracts/EmploymentLoan.sol
        // see https://github.com/superfluid-finance/super-examples/blob/main/projects/borrow-against-salary/test/EmploymentLoan.test.js

        require(
            underlyingToken.transfer(msg.sender, uint256(amount)),
            "Token transfer not successful"
        );
        
        acceptedToken.createFlowFrom(msg.sender, address(this), 10);
        
        borrowAmount += amount;

        
    }

    function repay(int256 amount) public {
        // repay
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
        console.log("flowRate", uint96(flowRate));
        flowRate = 0; // delete me

        // Update flow
        if (flowRate == 0) {
            acceptedToken.deleteFlowFrom(msg.sender, address(this));
        } else {
            acceptedToken.updateFlowFrom(msg.sender, address(this), 1);
        }

    }

    function liquidateUser() private {
        console.log("entered liquidation");
    }

    // ---------------------------------------------------------------------------------------------
    // SUPER APP CALLBACKS
function beforeAgreementCreated(
        ISuperToken /*superToken*/,
        address /*agreementClass*/,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata _ctx /*ctx*/
    )
        external
        view
        virtual
        override
        returns (bytes memory /*cbdata*/)
    {
        //revert("Unsupported callback - Before Agreement Created");
        return _ctx;
    }

    function beforeAgreementTerminated(
        ISuperToken /*superToken*/,
        address /*agreementClass*/,
        bytes32 /*agreementId*/,
        bytes calldata /*agreementData*/,
        bytes calldata _ctx /*ctx*/
    )
        external
        view
        virtual
        override
        returns (bytes memory /*cbdata*/)
    {
        console.log("beforeAgreementTerminated");
        //revert("Unsupported callback - Before Agreement Created");
        return _ctx;
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address _agreementClass,
        bytes32, //_agreementId
        bytes calldata, //_agreementData
        bytes calldata, //_cbdata
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        console.log("afterAgreementCreated");
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
        override
        onlyExpected(_superToken, _agreementClass)
        onlyHost
        returns (bytes memory newCtx)
    {
        console.log("afterAgreementUpdated");
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
        // According to the app basic law, we should never revert in a termination callback
        console.log("afterAgreementTerminated");
        liquidateUser();
        return _ctx;
    }

    // ---------------------------------------------------------------------------------------------

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external pure returns (bytes4) {
        //return abi.encodeWithSignature("onERC721Received(address,address,uint256,bytes)", operator, from, tokenId, data);
        return IERC721Receiver.onERC721Received.selector;
    }
}
