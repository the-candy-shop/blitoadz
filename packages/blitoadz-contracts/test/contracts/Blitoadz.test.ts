import { setupUser, setupUsers } from "./utils";
import chai from "chai";
import {
  deployments,
  ethers,
  getNamedAccounts,
  getUnnamedAccounts,
  network,
} from "hardhat";
import { solidity } from "ethereum-waffle";
import { TAGS } from "../../utils/constants";
import { jestSnapshotPlugin } from "mocha-chai-jest-snapshot";
import { Blitmap__factory, Blitoadz } from "../../typechain";

chai.use(jestSnapshotPlugin());
chai.use(solidity);
const { expect } = chai;

const setup = async () => {
  await deployments.fixture([TAGS.BLITOADZ]);
  const { deployer, blitmap, focusPoint, gb, clemlaflemme } =
    await getNamedAccounts();
  const contracts = {
    Blitoadz: (await ethers.getContract("Blitoadz")) as Blitoadz,
    Blitmap: Blitmap__factory.connect(
      blitmap,
      await ethers.getSigner(deployer)
    ),
  };
  const constants = {
    MINT_PUBLIC_PRICE: await contracts.Blitoadz.MINT_PUBLIC_PRICE(),
    TOADZ_COUNT: await contracts.Blitoadz.TOADZ_COUNT(),
    BLITMAP_COUNT: await contracts.Blitoadz.BLITMAP_COUNT(),
    BLITOADZ_COUNT: await contracts.Blitoadz.BLITOADZ_COUNT(),
    blitmapCreatorShares: await contracts.Blitoadz.blitmapCreatorShares(),
  };
  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    ...constants,
    deployer: await setupUser(deployer, contracts),
    focusPoint: await setupUser(focusPoint, contracts),
    gb: await setupUser(gb, contracts),
    clemlaflemme: await setupUser(clemlaflemme, contracts),
  };
};

const publicSaleFixture = deployments.createFixture(async ({ network }) => {
  const contractsAndUsers = await setup();
  await contractsAndUsers.deployer.Blitoadz.openPublicSale();
  await network.provider.send("evm_mine");
  return contractsAndUsers;
});

describe("Blitoadz", function () {
  describe("mintPublicSale", async function () {
    it("should revert when minting is not open", async () => {
      const { users } = await setup();
      await expect(
        users[0].Blitoadz.mintPublicSale([0], [0], [0])
      ).to.be.revertedWith("PublicSaleNotOpen");
    });
    it("should revert when price is not good", async () => {
      const { users } = await publicSaleFixture();
      await expect(
        users[0].Blitoadz.mintPublicSale([0], [0], [0])
      ).to.be.revertedWith("IncorrectPrice");
    });
    it("should revert when toadzIds and blitmapIds length do not match", async () => {
      const { users, MINT_PUBLIC_PRICE } = await publicSaleFixture();
      await expect(
        users[0].Blitoadz.mintPublicSale([0], [0, 1], [0], {
          value: MINT_PUBLIC_PRICE,
        })
      ).to.be.revertedWith("ToadzAndBlitmapLengthMismatch");
    });
    it("should mint one blitoadz", async () => {
      const { users, Blitoadz, MINT_PUBLIC_PRICE } = await publicSaleFixture();
      await users[0].Blitoadz.mintPublicSale([0], [0], [27], {
        value: MINT_PUBLIC_PRICE,
      });
      const owner = await Blitoadz.ownerOf(0);
      expect(owner).to.eq(users[0].address);
      const { toadzId, blitmapId, paletteOrder } = await Blitoadz.blitoadz(0);
      expect(toadzId).to.eq(0);
      expect(blitmapId).to.eq(0);
      expect(paletteOrder).to.eq(27); // default palette order 00 01 10 11
    });
    it("should batch mint blitoadz", async () => {
      const { users, Blitoadz, MINT_PUBLIC_PRICE } = await publicSaleFixture();
      await users[0].Blitoadz.mintPublicSale(
        [0, 1, 2],
        [10, 11, 12],
        [27, 108, 228],
        {
          value: MINT_PUBLIC_PRICE.mul(3),
        }
      );
      const owners = await Promise.all(
        [...Array(3).keys()].map(
          async (tokenId) => await Blitoadz.ownerOf(tokenId)
        )
      );
      expect(new Set(owners).size).to.eq(1);
      expect(owners[0]).to.eq(users[0].address);
    });
    it("should revert when trying to mint an existing combination", async () => {
      const { users, MINT_PUBLIC_PRICE } = await publicSaleFixture();
      await users[0].Blitoadz.mintPublicSale([0], [0], [0], {
        value: MINT_PUBLIC_PRICE,
      });
      await expect(
        users[1].Blitoadz.mintPublicSale([0], [0], [0], {
          value: MINT_PUBLIC_PRICE,
        })
      ).to.be.revertedWith("BlitoadzExists");
    });
    it("should mint out and pay out", async () => {
      const {
        users,
        MINT_PUBLIC_PRICE,
        Blitoadz,
        focusPoint,
        gb,
        clemlaflemme,
      } = await publicSaleFixture();
      for (let toadzId = 0; toadzId < 56; toadzId++) {
        await users[0].Blitoadz.mintPublicSale(
          Array(100).fill(toadzId),
          [...Array(100).keys()],
          Array(100).fill(toadzId),
          {
            value: MINT_PUBLIC_PRICE.mul(100),
          }
        );
      }
      const totalSupply = await users[0].Blitoadz.totalSupply();
      expect(totalSupply).to.eq(5_600);
      await focusPoint.Blitoadz.withdrawFounder();
      expect(
        (await Blitoadz.founders(focusPoint.address)).withdrawnAmount
      ).to.eq(MINT_PUBLIC_PRICE.mul(1680));
      await gb.Blitoadz.withdrawFounder();
      expect((await Blitoadz.founders(gb.address)).withdrawnAmount).to.eq(
        MINT_PUBLIC_PRICE.mul(628)
      );
      await clemlaflemme.Blitoadz.withdrawFounder();
      expect(
        (await Blitoadz.founders(clemlaflemme.address)).withdrawnAmount
      ).to.eq(MINT_PUBLIC_PRICE.mul(628));
    });
  });
  describe("mintAllocation", async function () {
    it("should mint up to given allocation and revert", async () => {
      const { focusPoint, Blitoadz } = await publicSaleFixture();
      let { remainingAllocation } = await Blitoadz.founders(focusPoint.address);
      const tokenIds = [...Array(remainingAllocation).keys()];
      await focusPoint.Blitoadz.mintAllocation(tokenIds, tokenIds, tokenIds);
      const balance = await Blitoadz.balanceOf(focusPoint.address);
      expect(balance).to.eq(remainingAllocation);
      remainingAllocation = (await Blitoadz.founders(focusPoint.address))
        .remainingAllocation;
      expect(remainingAllocation).to.eq(0);
      await expect(
        focusPoint.Blitoadz.mintAllocation([0], [0], [27])
      ).to.be.revertedWith("AllocationExceeded");
    });
  });
  describe("withdrawBlitmapCreator", async function () {
    it("should revert when token does not exist", async () => {
      const { users } = await setup();
      await expect(
        users[0].Blitoadz.withdrawBlitmapCreator([0])
      ).to.be.revertedWith("WithdrawalQueryForNonexistentToken");
    });
    it("should revert when caller is not a Blitmap creator", async () => {
      const { users, MINT_PUBLIC_PRICE } = await publicSaleFixture();
      await users[0].Blitoadz.mintPublicSale([0], [0], [0], {
        value: MINT_PUBLIC_PRICE,
      });
      await expect(
        users[0].Blitoadz.withdrawBlitmapCreator([0])
      ).to.be.revertedWith("NothingToWithdraw");
    });
    it("should withdraw and revert second withdraw when caller is a Blitmap creator", async () => {
      const {
        users,
        MINT_PUBLIC_PRICE,
        BLITOADZ_COUNT,
        Blitoadz,
        Blitmap,
        blitmapCreatorShares,
      } = await publicSaleFixture();
      await users[0].Blitoadz.mintPublicSale([0], [0], [0], {
        value: MINT_PUBLIC_PRICE,
      });

      const creator = await Blitmap.tokenCreatorOf(0);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [creator],
      });
      await (
        await ethers.getSigner(users[0].address)
      ).sendTransaction({
        to: creator,
        value: ethers.utils.parseEther("100"),
      });
      const balancePrev = await ethers.provider.getBalance(creator);
      const CreatorBlitoadz = await Blitoadz.connect(
        await ethers.getSigner(creator)
      );
      const tx = await CreatorBlitoadz.withdrawBlitmapCreator([0]);
      const receipt = await tx.wait();
      const paidFees = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const balanceNew = await ethers.provider.getBalance(creator);
      expect(balanceNew.add(paidFees).sub(balancePrev)).to.eq(
        MINT_PUBLIC_PRICE.mul(blitmapCreatorShares).div(BLITOADZ_COUNT)
      );
      const blitoadz = await Blitoadz.blitoadz(0);
      expect(blitoadz.withdrawn).to.be.true;
      await expect(
        CreatorBlitoadz.withdrawBlitmapCreator([0])
      ).to.be.revertedWith("NothingToWithdraw");
    });
  });
  describe("withdrawFounder", async function () {
    it("should revert when user is not founder", async () => {
      const { users, Blitoadz } = await setup();
      await expect(users[0].Blitoadz.withdrawFounder()).to.be.revertedWith(
        "NothingToWithdraw"
      );
      expect((await Blitoadz.founders(users[0].address)).shares).to.eq(0);
    });
    it("should revert when no token has been minted", async () => {
      const { focusPoint } = await setup();
      await expect(focusPoint.Blitoadz.withdrawFounder()).to.be.revertedWith(
        "NothingToWithdraw"
      );
    });
    it("should revert when minted token is founder allocation", async () => {
      const { focusPoint } = await publicSaleFixture();
      await focusPoint.Blitoadz.mintAllocation([0], [0], [0]);
      await expect(focusPoint.Blitoadz.withdrawFounder()).to.be.revertedWith(
        "NothingToWithdraw"
      );
    });
    it("should withdraw and revert second withdraw when caller is a Founder", async () => {
      const { users, focusPoint, MINT_PUBLIC_PRICE, BLITOADZ_COUNT, Blitoadz } =
        await publicSaleFixture();
      await users[0].Blitoadz.mintPublicSale([0], [0], [0], {
        value: MINT_PUBLIC_PRICE,
      });

      const founderShares = (await Blitoadz.founders(focusPoint.address))
        .shares;
      const balancePrev = await ethers.provider.getBalance(focusPoint.address);
      const tx = await focusPoint.Blitoadz.withdrawFounder();
      const receipt = await tx.wait();
      const paidFees = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const balanceNew = await ethers.provider.getBalance(focusPoint.address);
      expect(balanceNew.add(paidFees).sub(balancePrev)).to.eq(
        MINT_PUBLIC_PRICE.mul(founderShares).div(BLITOADZ_COUNT)
      );
      const blitoadz = await Blitoadz.blitoadz(0);
      expect(blitoadz.withdrawn).to.be.false;
      await expect(focusPoint.Blitoadz.withdrawFounder()).to.be.revertedWith(
        "NothingToWithdraw"
      );
    });
  });
});
