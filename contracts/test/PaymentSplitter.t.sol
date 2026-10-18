// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PaymentSplitter} from "../PaymentSplitter.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ──────────────────────────────────────────────────────────────────────────────
// Handler for invariant testing: calls splitPayment with valid inputs so the
// invariant runner can explore state transitions.
//
// Design notes:
//   • The handler itself is msg.sender for every splitPayment call — it mints
//     tokens to itself and approves the splitter.  No vm.prank is needed and
//     none is used, which keeps the invariant runner's call-frame clean.
//   • Recipient balances are allowed to accumulate freely; the invariant only
//     checks the splitter's own balance (which must always stay at zero).
// ──────────────────────────────────────────────────────────────────────────────
contract SplitHandler is Test {
    PaymentSplitter public splitter;
    MockERC20       public usdc;
    address         public alice;
    address         public bob;
    address         public carol;

    constructor(PaymentSplitter _splitter, MockERC20 _usdc, address _alice, address _bob, address _carol) {
        splitter = _splitter;
        usdc     = _usdc;
        alice    = _alice;
        bob      = _bob;
        carol    = _carol;
    }

    /// @dev Fuzz a valid 2-recipient split (alice/bob, bps must sum to 10_000).
    function split2(uint256 amount, uint16 bps0) external {
        // Keep amount in a sensible range to avoid mock overflow.
        amount = bound(amount, 1, 1_000_000e6);
        // bps0 in [1, 9999] so bps1 = 10_000 - bps0 is also ≥ 1 (no zero-bps revert).
        bps0 = uint16(bound(uint256(bps0), 1, 9_999));
        uint16 bps1 = 10_000 - bps0;

        // Seed the handler (msg.sender) with tokens + allowance.
        usdc.mint(address(this), amount);
        usdc.approve(address(splitter), amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bpsArr = new uint16[](2);
        bpsArr[0] = bps0;
        bpsArr[1] = bps1;

        splitter.splitPayment(recipients, bpsArr, amount);
    }

    /// @dev Fuzz a valid 3-recipient split (alice/bob/carol).
    function split3(uint256 amount, uint16 bps0, uint16 bps1) external {
        amount = bound(amount, 1, 1_000_000e6);
        bps0   = uint16(bound(uint256(bps0),  1, 9_998));
        bps1   = uint16(bound(uint256(bps1),  1, 9_999 - bps0));
        uint16 bps2 = 10_000 - bps0 - bps1;

        usdc.mint(address(this), amount);
        usdc.approve(address(splitter), amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint16[] memory bpsArr = new uint16[](3);
        bpsArr[0] = bps0;
        bpsArr[1] = bps1;
        bpsArr[2] = bps2;

        splitter.splitPayment(recipients, bpsArr, amount);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main test contract
// ──────────────────────────────────────────────────────────────────────────────
contract PaymentSplitterTest is Test {

    // ── Constants ──────────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    // ── State ──────────────────────────────────────────────────────────────────
    PaymentSplitter internal splitter;
    MockERC20       internal usdc;

    address internal sender = makeAddr("sender");
    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal carol  = makeAddr("carol");

    // ── setUp ──────────────────────────────────────────────────────────────────
    function setUp() public {
        // 1. Deploy a fresh MockERC20 to a throwaway address.
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);

        // 2. Etch the mock's runtime bytecode at the hardcoded USDC constant.
        vm.etch(USDC_ADDR, address(mock).code);

        // 3. Bind a typed handle to the canonical address.
        usdc = MockERC20(USDC_ADDR);

        // 4. Deploy the contract under test.
        splitter = new PaymentSplitter();
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /// @dev Seed `sender` with `amount` USDC and approve the splitter.
    function _seed(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(splitter), amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 1. Deployment / initialization
    // ══════════════════════════════════════════════════════════════════════════

    function test_UsdcConstantIsCorrect() public view {
        assertEq(splitter.USDC(), USDC_ADDR);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. Happy path — 2 recipients, equal split (5000 / 5000)
    // ══════════════════════════════════════════════════════════════════════════

    function test_HappyPath_2Recipients_EqualSplit() public {
        uint256 amount = 1_000e6; // 1 000 USDC
        _seed(sender, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        assertEq(usdc.balanceOf(alice),  500e6, "alice share");
        assertEq(usdc.balanceOf(bob),    500e6, "bob share");
        assertEq(usdc.balanceOf(address(splitter)), 0, "splitter holds zero");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2b. PaymentSplit event emitted correctly (2 recipients)
    // ══════════════════════════════════════════════════════════════════════════

    function test_EmitsPaymentSplitEvent_2Recipients() public {
        uint256 amount = 1_000e6;
        _seed(sender, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        uint256[] memory expectedShares = new uint256[](2);
        expectedShares[0] = 500e6;
        expectedShares[1] = 500e6;

        // checkTopic1=true (sender), checkTopic2=false (not indexed), checkData=true
        vm.expectEmit(true, false, false, true, address(splitter));
        emit PaymentSplitter.PaymentSplit(sender, amount, recipients, expectedShares);

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3. Happy path — 3 recipients, unequal split (3000 / 3000 / 4000)
    // ══════════════════════════════════════════════════════════════════════════

    function test_HappyPath_3Recipients_UnequalSplit() public {
        uint256 amount = 1_000e6;
        _seed(sender, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint16[] memory bps = new uint16[](3);
        bps[0] = 3_000;
        bps[1] = 3_000;
        bps[2] = 4_000;

        // Expected: 1000e6 * 3000/10000 = 300e6 each for alice+bob; carol = 400e6
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        assertEq(usdc.balanceOf(alice),  300e6, "alice share");
        assertEq(usdc.balanceOf(bob),    300e6, "bob share");
        assertEq(usdc.balanceOf(carol),  400e6, "carol share");
        assertEq(usdc.balanceOf(address(splitter)), 0, "splitter holds zero");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3b. PaymentSplit event emitted correctly (3 recipients)
    // ══════════════════════════════════════════════════════════════════════════

    function test_EmitsPaymentSplitEvent_3Recipients() public {
        uint256 amount = 1_000e6;
        _seed(sender, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint16[] memory bps = new uint16[](3);
        bps[0] = 3_000;
        bps[1] = 3_000;
        bps[2] = 4_000;

        uint256[] memory expectedShares = new uint256[](3);
        expectedShares[0] = 300e6;
        expectedShares[1] = 300e6;
        expectedShares[2] = 400e6;

        vm.expectEmit(true, false, false, true, address(splitter));
        emit PaymentSplitter.PaymentSplit(sender, amount, recipients, expectedShares);

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. Dust rounding: amount=3, bps=[3334,3333,3333]
    //    alice=floor(3*3334/10000)=1, bob=floor(3*3333/10000)=0
    //    carol (last) = 3 - 1 - 0 = 2
    // ══════════════════════════════════════════════════════════════════════════

    function test_DustAbsorbedByLastRecipient_3Recipients() public {
        uint256 amount = 3;
        _seed(sender, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint16[] memory bps = new uint16[](3);
        bps[0] = 3_334; // floor(3*3334/10000) = floor(1.0002) = 1
        bps[1] = 3_333; // floor(3*3333/10000) = floor(0.9999) = 0
        bps[2] = 3_333; // last: 3 - 1 - 0 = 2

        // Must succeed (no revert) even though bob gets 0.
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        assertEq(usdc.balanceOf(alice), 1, "alice gets 1");
        assertEq(usdc.balanceOf(bob),   0, "bob gets 0 (rounded down)");
        assertEq(usdc.balanceOf(carol), 2, "carol absorbs dust, gets 2");
        assertEq(usdc.balanceOf(address(splitter)), 0, "splitter holds zero");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5. Extreme dust: amount=1, bps=[5000,5000]
    //    alice=floor(1*5000/10000)=0, bob (last) = 1 - 0 = 1
    // ══════════════════════════════════════════════════════════════════════════

    function test_ExtremeDust_Amount1_TwoRecipients() public {
        uint256 amount = 1;
        _seed(sender, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        // Must succeed — alice gets 0, bob gets 1.
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        assertEq(usdc.balanceOf(alice), 0, "alice gets 0");
        assertEq(usdc.balanceOf(bob),   1, "bob absorbs all dust");
        assertEq(usdc.balanceOf(address(splitter)), 0, "splitter holds zero");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 6. Revert: ZeroAmount
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_ZeroAmount() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        vm.expectRevert(PaymentSplitter.ZeroAmount.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 7. Revert: InvalidRecipientCount — 1 recipient
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_InvalidRecipientCount_One() public {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;

        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        vm.expectRevert(PaymentSplitter.InvalidRecipientCount.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 7b. Revert: InvalidRecipientCount — 4 recipients
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_InvalidRecipientCount_Four() public {
        address extra = makeAddr("extra");

        address[] memory recipients = new address[](4);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;
        recipients[3] = extra;

        uint16[] memory bps = new uint16[](4);
        bps[0] = 2_500;
        bps[1] = 2_500;
        bps[2] = 2_500;
        bps[3] = 2_500;

        vm.expectRevert(PaymentSplitter.InvalidRecipientCount.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 8. Revert: LengthMismatch
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_LengthMismatch() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        // Only one bps element — mismatch with 2 recipients.
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        vm.expectRevert(PaymentSplitter.LengthMismatch.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 9a. Revert: InvalidBps — sum != 10,000
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_InvalidBps_SumNot10000() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 4_999; // sum = 9999, not 10000

        vm.expectRevert(PaymentSplitter.InvalidBps.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 9b. Revert: InvalidBps — bps[i] == 0
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_InvalidBps_ZeroBps() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 0;       // explicitly zero
        bps[1] = 10_000;

        vm.expectRevert(PaymentSplitter.InvalidBps.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 9c. Revert: InvalidBps — sum > 10,000
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_InvalidBps_SumOver10000() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_001;
        bps[1] = 5_000; // sum = 10001

        vm.expectRevert(PaymentSplitter.InvalidBps.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 10. Revert: ZeroAddress
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_ZeroAddress_FirstRecipient() public {
        address[] memory recipients = new address[](2);
        recipients[0] = address(0);
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        vm.expectRevert(PaymentSplitter.ZeroAddress.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    function test_Revert_ZeroAddress_SecondRecipient() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = address(0);

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        vm.expectRevert(PaymentSplitter.ZeroAddress.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 11. Revert: DuplicateRecipient — 2-element array
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_DuplicateRecipient_2Elements() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = alice; // duplicate

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        vm.expectRevert(PaymentSplitter.DuplicateRecipient.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 11b. Revert: DuplicateRecipient — 3-element array, adjacent pair
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_DuplicateRecipient_3Elements_Adjacent() public {
        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = bob; // dup of index 1

        uint16[] memory bps = new uint16[](3);
        bps[0] = 3_000;
        bps[1] = 3_000;
        bps[2] = 4_000;

        vm.expectRevert(PaymentSplitter.DuplicateRecipient.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 11c. Revert: DuplicateRecipient — 3-element array, non-adjacent pair
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_DuplicateRecipient_3Elements_NonAdjacent() public {
        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = alice; // dup of index 0

        uint16[] memory bps = new uint16[](3);
        bps[0] = 3_000;
        bps[1] = 3_000;
        bps[2] = 4_000;

        vm.expectRevert(PaymentSplitter.DuplicateRecipient.selector);
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 12. Griefing immunity: unsolicited USDC sent to contract before splitPayment
    //     The accounting check uses arithmetic (pushed == amount), not balanceOf(),
    //     so a pre-seeded balance cannot strand funds or cause a revert.
    // ══════════════════════════════════════════════════════════════════════════

    function test_GriefingImmunity_UnsolicitedDeposit() public {
        uint256 amount = 100e6;
        _seed(sender, amount);

        // Attacker sends 50e6 directly to the splitter before the call.
        address attacker = makeAddr("attacker");
        usdc.mint(attacker, 50e6);
        vm.prank(attacker);
        usdc.transfer(address(splitter), 50e6);

        // Splitter now holds 50e6 "unsolicited" tokens.
        assertEq(usdc.balanceOf(address(splitter)), 50e6, "pre-condition: stranded tokens");

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        // splitPayment must still succeed and distribute exactly `amount`.
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        assertEq(usdc.balanceOf(alice), 50e6, "alice gets correct share");
        assertEq(usdc.balanceOf(bob),   50e6, "bob gets correct share");
        // Stranded tokens remain in the splitter (not swept — expected behaviour).
        assertEq(usdc.balanceOf(address(splitter)), 50e6, "stranded tokens untouched");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 13. Revert: TransferFailed — transferFrom fails (insufficient allowance)
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_TransferFailed_InsufficientAllowance() public {
        usdc.mint(sender, 100e6);
        // Do NOT approve — allowance is zero.

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 5_000;

        // MockERC20.transferFrom reverts with a require string (not TransferFailed)
        // when allowance is insufficient — the splitter's `if (!transferFrom(...))` path
        // is actually unreachable here because the mock reverts before returning false.
        // Test that the overall call reverts (for any reason) protecting the sender.
        vm.expectRevert();
        vm.prank(sender);
        splitter.splitPayment(recipients, bps, 100e6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 14. Fuzz: verify sum(recipient balances) == amount when call succeeds
    //     Uses 2-recipient split to keep fuzz parameters minimal.
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Fuzz over amount and bps0; bps1 is derived so they sum to 10_000.
    function testFuzz_SumOfSharesEqualsAmount(uint256 amount, uint16 bps0) public {
        amount = bound(amount, 1, 1_000_000e6);
        // bps0 in [1, 9999] ensures bps1 = 10_000 - bps0 is also ≥ 1.
        bps0   = uint16(bound(uint256(bps0), 1, 9_999));
        uint16 bps1 = 10_000 - bps0;

        _seed(sender, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = bps0;
        bps[1] = bps1;

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        uint256 aliceGot = usdc.balanceOf(alice) - aliceBefore;
        uint256 bobGot   = usdc.balanceOf(bob)   - bobBefore;

        assertEq(aliceGot + bobGot, amount, "sum of shares must equal amount");
        assertEq(usdc.balanceOf(address(splitter)), 0, "splitter must hold zero");
    }

    /// @dev Fuzz the 3-recipient case.
    function testFuzz_SumOfSharesEqualsAmount_3Recipients(
        uint256 amount,
        uint16 bps0,
        uint16 bps1
    ) public {
        amount = bound(amount, 1, 1_000_000e6);
        bps0   = uint16(bound(uint256(bps0),  1, 9_998));
        bps1   = uint16(bound(uint256(bps1),  1, 9_999 - bps0));
        uint16 bps2 = 10_000 - bps0 - bps1;

        _seed(sender, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint16[] memory bps = new uint16[](3);
        bps[0] = bps0;
        bps[1] = bps1;
        bps[2] = bps2;

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);
        uint256 carolBefore = usdc.balanceOf(carol);

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        uint256 aliceGot = usdc.balanceOf(alice) - aliceBefore;
        uint256 bobGot   = usdc.balanceOf(bob)   - bobBefore;
        uint256 carolGot = usdc.balanceOf(carol) - carolBefore;

        assertEq(aliceGot + bobGot + carolGot, amount, "sum of 3 shares must equal amount");
        assertEq(usdc.balanceOf(address(splitter)), 0, "splitter must hold zero after 3-way split");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 15. Edge: large amount, asymmetric split — verify dust lands on last recipient
    // ══════════════════════════════════════════════════════════════════════════

    function test_DustLandsOnLastRecipient_LargeAmount() public {
        // 1e6 + 1 causes non-zero dust with bps=[3333,3333,3334]
        // floor((1e6+1) * 3333 / 10000) = floor(333300.3333) = 333300
        // alice + bob = 666600, carol = (1e6+1) - 666600 = 333401
        uint256 amount = 1_000_001;
        _seed(sender, amount);

        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;

        uint16[] memory bps = new uint16[](3);
        bps[0] = 3_333;
        bps[1] = 3_333;
        bps[2] = 3_334;

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        uint256 aliceShare = (amount * 3_333) / 10_000;
        uint256 bobShare   = (amount * 3_333) / 10_000;
        uint256 carolShare = amount - aliceShare - bobShare;

        assertEq(usdc.balanceOf(alice),  aliceShare,  "alice");
        assertEq(usdc.balanceOf(bob),    bobShare,    "bob");
        assertEq(usdc.balanceOf(carol),  carolShare,  "carol absorbs dust");
        assertEq(
            usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol),
            amount,
            "total"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 16. Edge: single-unit bps (100% to one of two via 9999/1)
    // ══════════════════════════════════════════════════════════════════════════

    function test_MinimalBps_OneRecipientGetsAlmost100Percent() public {
        uint256 amount = 1_000e6;
        _seed(sender, amount);

        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint16[] memory bps = new uint16[](2);
        bps[0] = 9_999; // alice gets floor(1000e6 * 9999/10000) = 999900000
        bps[1] = 1;     // bob (last) gets remainder = 100000

        vm.prank(sender);
        splitter.splitPayment(recipients, bps, amount);

        uint256 expectedAlice = (amount * 9_999) / 10_000;
        uint256 expectedBob   = amount - expectedAlice;

        assertEq(usdc.balanceOf(alice), expectedAlice, "alice");
        assertEq(usdc.balanceOf(bob),   expectedBob,   "bob");
        assertEq(usdc.balanceOf(alice) + usdc.balanceOf(bob), amount, "total");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Invariant test contract — separate from unit tests per Foundry convention.
// ──────────────────────────────────────────────────────────────────────────────
contract PaymentSplitterInvariantTest is Test {

    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    PaymentSplitter internal splitter;
    MockERC20       internal usdc;
    SplitHandler    internal handler;

    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        // Etch MockERC20 at canonical USDC address.
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mock).code);
        usdc     = MockERC20(USDC_ADDR);
        splitter = new PaymentSplitter();

        // Deploy the handler; it holds its own USDC balance for seeding.
        handler  = new SplitHandler(splitter, usdc, alice, bob, carol);

        // Restrict the invariant runner to only call handler functions.
        targetContract(address(handler));
    }

    /// @dev Core invariant: the splitter must hold zero USDC after any
    ///      splitPayment call. It is stateless (no deposit/withdrawal surface),
    ///      so any residual balance would represent a permanent loss of funds.
    function invariant_SplitterHoldsZeroUSDC() public view {
        assertEq(
            usdc.balanceOf(address(splitter)),
            0,
            "invariant: splitter must hold zero USDC after every splitPayment"
        );
    }
}
