import {SuperToken} from "@superfluid-finance/sdk-core";
import * as hre from "hardhat";
import {Provider} from "@ethersproject/providers";
import {MintableNFT, NFTLendingPool, TestToken} from "../typechain-types";
import {expect} from "chai";

const { Framework } = require("@superfluid-finance/sdk-core");
const { deployTestFramework } = require("@superfluid-finance/ethereum-contracts/dev-scripts/deploy-test-framework");
const TestTokenJson = require("@superfluid-finance/ethereum-contracts/build/contracts/TestToken.json");

const thousandEther = hre.ethers.utils.parseEther("1000");

describe("Test NFT Superfluid Lending pool", async () => {

    let a: number;
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
        console.log('entered before');
    });

    beforeEach(async () => {

        // from https://github.com/superfluid-finance/super-examples/blob/main/projects/tradeable-cashflow/test/TradeableCashflow.test.js

        //get accounts from hardhat
        [owner] = await hre.ethers.getSigners();
        ownerAddress = await owner.getAddress();
        provider = owner.provider!;
        const sfDeployer = await deployTestFramework();

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
            12,
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
        await daix.transferFrom({sender: owner.address,
              receiver: nftLendingPoolContract.address,
              amount: (thousandEther.div(2)).toString()}).exec(owner);
        
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

    xit("user can borrow 100 DAI", async () => {
        // Todo - Implement send/cancel cashflows
        // as in https://github.com/superfluid-finance/super-examples/blob/main/projects/tradeable-cashflow/test/TradeableCashflow.test.js
        // ToDo
        //  Implement app logic
        //  - Deploy NFT pool (interestRate 10%)
        //  - Deposit NFT
        //  - Borrow 100 DAI (should create a fDAIx flow) - check that flow is created
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
        console.log('before');
        await nftLendingPoolContract.borrowAgainstCollateral(
            hre.ethers.utils.parseEther(loanAmount.toString()));
        console.log('after');

        const ownerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        });

        const expectedFlowRate = -loanAmount * interestRate / 100;
        expect(parseInt(ownerFlowRate)).to.be.equal(expectedFlowRate);

        const ownerDaiAmount = await dai.balanceOf(owner.address);
        expect(ownerDaiAmount).to.eq(hre.ethers.utils.parseEther(loanAmount.toString()));
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

        await nftLendingPoolContract.borrowAgainstCollateral(hre.ethers.utils.parseEther(loanAmount.toString()));
        console.log('after borrow');
        console.log('curr balance dai owner', await dai.balanceOf(owner.address));


        //const expectedFlowRate = -loanAmount * interestRate / 100;

        // repay
        console.log('repay');
        await nftLendingPoolContract.repay(hre.ethers.utils.parseEther(loanAmount.toString()));
        const updatedOwnerFlowRate = await daix.getNetFlow({
            account: ownerAddress,
            providerOrSigner: owner
        })
        console.log(`updated ${updatedOwnerFlowRate}`);
        expect(updatedOwnerFlowRate).to.eq('0');

        const ownerBalanceDai = await dai.balanceOf(owner.address);
        expect(ownerBalanceDai).to.equal(0);
    });

    xit('a', () => {
        // Other test
        // - Deposit NFT
        // - Borrow 100 DAI (should create a fDAIx flow) - check that flow is created
        // - Try deleting flow
        // - Assert liquidation occurred

    });

    xit('a', () => {
        // Other test
        // - Deposit NFT
        // - Borrow 100 DAI (should create a fDAIx flow) - check that flow is created
        // - Repay 50
        // - Assert flow updated to 50
    });

});
