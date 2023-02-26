import { SuperToken } from "@superfluid-finance/sdk-core";
import * as hre from "hardhat";
import { Provider } from "@ethersproject/providers";
import { MintableNFT, NFTLendingPool, TestToken } from "../typechain-types";
import { expect } from "chai";

const { Framework } = require("@superfluid-finance/sdk-core");
const { deployTestFramework } = require("@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework");
const TestTokenJson = require("@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json");

const thousandEther = hre.ethers.utils.parseEther("1000");

describe("Test NFT Superfluid Lending pool", async () => {

    let sfDeployer: any;
    let daix: SuperToken;
    let dai: TestToken;
    let owner: hre.ethers.Signer;
    let ownerAddress: string;
    let provider: Provider;
    let nft: MintableNFT;
    let nftLendingPoolContract: NFTLendingPool;
    let hostAddress: string;
    let cfaV1Address: string;
    const interestRate = 10;

    before(async () => {
        [owner] = await hre.ethers.getSigners();
        ownerAddress = await owner.getAddress();
        provider = owner.provider!;

        sfDeployer = await deployTestFramework();
    });

    beforeEach(async () => {

        // from https://github.com/superfluid-finance/super-examples/blob/main/projects/tradeable-cashflow/test/TradeableCashflow.test.js

        // GETTING SUPERFLUID FRAMEWORK SET UP
        // deploy the framework locally
        const contractsFramework = await sfDeployer.getFramework();

        //initialize the superfluid framework...put custom and web3 only bc we are usinghardhat locally
        const sf = await Framework.create({
            chainId: 31337, //note: this is hardhat's local chainId
            provider,
            resolverAddress: contractsFramework.resolver, //this is how you get the resolveraddress
            protocolReleaseVersion: "test"
        });

        hostAddress = sf.settings.config.hostAddress;
        cfaV1Address = sf.settings.config.cfaV1Address;

        // DEPLOYING DAI and DAI wrapper super token
        const tokenDeployment = await sfDeployer.deployWrapperSuperToken(
            "Fake DAI Token",
            "fDAI",
            18,
            hre.ethers.utils.parseEther("100000000").toString()
        )

        daix = await sf.loadSuperToken("fDAIx");
        dai = new hre.ethers.Contract(
            daix.underlyingToken!.address,
            TestTokenJson.abi,
            owner
        ) as TestToken;

        // deploying example NFT
        const NFT = await hre.ethers.getContractFactory("MintableNFT");
        nft = await NFT.deploy("name", "symbol") as MintableNFT;
        console.log('nft addr', nft.address);

        // deploying nft pool
        const NFTLendingPool = await hre.ethers.getContractFactory("NFTLendingPool");
        nftLendingPoolContract = await NFTLendingPool.deploy(
            nft.address,
            interestRate,
            hostAddress,
            cfaV1Address,
            daix.address,
            daix.underlyingToken?.address!
        ) as NFTLendingPool;
        console.log('nft lending pool addr', nftLendingPoolContract.address);

        // DAI and DAIx operations

        // approving DAIx to spend DAI (Super Token object is not an ethers contract object and has different operation syntax)
        await dai.connect(owner).approve(daix.address, hre.ethers.constants.MaxInt256);

        // owner
        await dai.connect(owner).mint(owner.address, thousandEther);
        // Upgrading all DAI to DAIx
        await daix.upgrade({ amount: thousandEther }).exec(owner);

        // contract
        await dai.connect(owner).mint(nftLendingPoolContract.address, thousandEther);
        await dai.connect(owner).approve(nftLendingPoolContract.address, hre.ethers.constants.MaxInt256);

        // transfer to contract
        await daix.transferFrom({
            sender: owner.address,
            receiver: nftLendingPoolContract.address,
            amount: (thousandEther.div(2)).toString()
        }).exec(owner);

        console.log('balance owner dai', await dai.balanceOf(owner.address));

        const authorize = await daix.authorizeFlowOperatorWithFullControl({ flowOperator: nftLendingPoolContract.address.toLowerCase() });
        await authorize.exec(owner);
    });


    async function mintNftToOwner(tokenId: number) {
        // mint NFT to owner
        await nft.safeMint(ownerAddress, tokenId);
        console.log('balance nft', await nft.balanceOf(ownerAddress));
        await nft.approve(nftLendingPoolContract.address, tokenId);
    }

    it("user can borrow 100 DAI", async () => {
        const nftTokenId = 1;

        await mintNftToOwner(nftTokenId);
        const daiBal = await daix.balanceOf({
            account: ownerAddress,
            providerOrSigner: owner
        });
        console.log("daix bal for acct 0: ", daiBal);

        await nftLendingPoolContract.depositCollateral(nftTokenId);
        const updatedNftBalance = await nft.balanceOf(ownerAddress);
        expect(updatedNftBalance).to.be.equal(0);

        const loanAmount = 100;
        await nftLendingPoolContract.borrowAgainstCollateral(
            loanAmount);

        const ownerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        });

        const expectedFlowRate = -loanAmount * interestRate / 100;
        expect(parseInt(ownerFlowRate)).to.be.equal(expectedFlowRate);

        const ownerDaiAmount = await dai.balanceOf(owner.address);
        expect(ownerDaiAmount).to.eq(loanAmount);
    });

    it('Repay loan and check that flow stopps', async () => {
        // Other test -
        // Repay remaining amount (check that flow stopped)
        const nftTokenId = 2;
        await mintNftToOwner(nftTokenId);

        const daiBal = await daix.balanceOf({
            account: ownerAddress,
            providerOrSigner: owner
        });
        console.log("daix bal for acct 0: ", daiBal);

        await nftLendingPoolContract.depositCollateral(nftTokenId);
        const updatedNftBalance = await nft.balanceOf(ownerAddress);
        expect(updatedNftBalance).to.be.equal(0);

        const loanAmount = 100;

        await nftLendingPoolContract.borrowAgainstCollateral(loanAmount);
        console.log('after borrow');
        console.log('curr balance dai owner', await dai.balanceOf(owner.address));

        // repay
        console.log('repay');
        await nftLendingPoolContract.repay(loanAmount);
        const updatedOwnerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        })
        console.log(`updated ${updatedOwnerFlowRate}`);
        expect(updatedOwnerFlowRate).to.eq('0');

        const ownerBalanceDai = await dai.balanceOf(owner.address);
        expect(ownerBalanceDai).to.equal(0);
    });



    it('User gets liquidated if delete flow attempt is executed', async () => {
        // Other test
        // - Deposit NFT
        // - Borrow 100 DAI (should create a fDAIx flow) - check that flow is created
        // - Try deleting flow
        // - Assert liquidation occurred
        const nftTokenId = 3;

        await mintNftToOwner(nftTokenId);

        await nftLendingPoolContract.depositCollateral(nftTokenId);

        const loanAmount = 100;

        await nftLendingPoolContract.borrowAgainstCollateral(
            loanAmount);

        // Cancel flow rate
        await daix.deleteFlow({
            sender: owner.address,
            receiver: nftLendingPoolContract.address
        }).exec(owner);

        const updatedOwnerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        })
        console.log(`updated ${updatedOwnerFlowRate}`);
        expect(updatedOwnerFlowRate).to.eq('0');

        const updatedNftBalance = await nft.balanceOf(nftLendingPoolContract.address);
        console.log('address nft chest', await nftLendingPoolContract.nftChest());
        expect(updatedNftBalance).to.be.equal(0);

        // ToDo - Assert borrowAmount == 0
        const updatedBorrowAmount = await nftLendingPoolContract.borrowAmount();
        expect(updatedBorrowAmount).to.equal(0);
    });

    it('Repaying 50 DAI updates user flow to 50 xDAI', async () => {
        // Other test
        // - Deposit NFT
        // - Borrow 100 DAI (should create a fDAIx flow) - check that flow is created
        // - Repay 50
        // - Assert flow updated to 50
        const nftTokenId = 4;
        await mintNftToOwner(nftTokenId);
        await nftLendingPoolContract.depositCollateral(nftTokenId);

        const loanAmount = 100;

        await nftLendingPoolContract.borrowAgainstCollateral(loanAmount);

        await nftLendingPoolContract.repay(loanAmount / 2);

        const updatedOwnerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        })
        console.log(`updated ${updatedOwnerFlowRate}`);

        const expectedFlowRate = -loanAmount / 2 * interestRate / 100;
        expect(parseInt(updatedOwnerFlowRate)).to.be.equal(expectedFlowRate);
    });

    it('flow rate calculated correctly', async () => {
        // deposit NFT
        // borrow 100 DAI
        // assert flow rate is 100 DAIx
        const nftTokenId = 5;
        await mintNftToOwner(nftTokenId);
        await nftLendingPoolContract.depositCollateral(nftTokenId);

        const loanAmount = 100;

        await nftLendingPoolContract.borrowAgainstCollateral(
            loanAmount);

        const flowRate = await nftLendingPoolContract.getPaymentFlowRate();
        console.log('flowRate', flowRate.toString());
        expect(flowRate).to.be.equal('10');
    });

    it('User gets NFT back if full amount is repaid', async () => {
        const nftTokenId = 6;

        await mintNftToOwner(nftTokenId);

        //await nft.approve(nftLendingPoolContract.address, nftTokenId);
        await nft.connect(owner).setApprovalForAll(nftLendingPoolContract.address, true);

        console.log('owner of', await nft.ownerOf(nftTokenId));
        console.log('approved ts', await nft.getApproved(nftTokenId));

        await nftLendingPoolContract.depositCollateral(nftTokenId);

        const loanAmount = 100;

        //await nft.setApprovalForAll(nftLendingPoolContract.address, true);


        await nftLendingPoolContract.borrowAgainstCollateral(
            loanAmount);

        await nftLendingPoolContract.repay(loanAmount);

        const updatedOwnerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        })
        console.log(`updated ${updatedOwnerFlowRate}`);
        expect(updatedOwnerFlowRate).to.eq('0');

        // ToDo - Assert nft was returned
        const updatedNftBalanceContract = await nft.balanceOf(nftLendingPoolContract.address);
        expect(updatedNftBalanceContract).to.be.equal(0);

        const updatedNftBalanceUser = await nft.balanceOf(ownerAddress);
        expect(updatedNftBalanceUser).to.be.equal(1);
    });

});
