// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PaymentSplitter {
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    event PaymentSplit(
        address indexed sender,
        uint256 totalAmount,
        address[] recipients,
        uint256[] shares
    );

    /// @notice Reverts when recipients length is not 2 or 3.
    error InvalidRecipientCount();

    /// @notice Reverts when recipients and bps arrays have different lengths.
    error LengthMismatch();

    /// @notice Reverts when any bps is zero or total bps does not equal 10,000.
    error InvalidBps();

    /// @notice Reverts when any recipient is the zero address.
    error ZeroAddress();

    /// @notice Reverts when duplicate recipient addresses are provided.
    error DuplicateRecipient();

    /// @notice Reverts when amount is zero.
    error ZeroAmount();

    /// @notice Reverts when a USDC transfer operation fails or funds remain stranded.
    error TransferFailed();

    /// @notice Splits an approved USDC amount across 2 or 3 recipients by basis-point shares.
    /// @dev Pulls full `amount` from sender first, then pushes each share; dust is assigned to the last recipient.
    /// @param recipients Recipient addresses (must be length 2 or 3, unique, and non-zero).
    /// @param bps Basis-point shares corresponding to each recipient; must sum to 10,000.
    /// @param amount Total USDC amount to split.
    function splitPayment(
        address[] calldata recipients,
        uint16[] calldata bps,
        uint256 amount
    ) external {
        if (amount == 0) revert ZeroAmount();

        uint256 len = recipients.length;
        if (len != bps.length) revert LengthMismatch();
        if (len < 2 || len > 3) revert InvalidRecipientCount();

        uint256 bpsSum = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            if (bps[i] == 0) revert InvalidBps();

            for (uint256 j = i + 1; j < len; ++j) {
                if (recipients[i] == recipients[j]) revert DuplicateRecipient();
            }

            bpsSum += bps[i];
        }

        if (bpsSum != 10_000) revert InvalidBps();

        uint256[] memory shares = new uint256[](len);
        uint256 distributed = 0;

        for (uint256 i = 0; i + 1 < len; ++i) {
            uint256 share = (amount * bps[i]) / 10_000;
            shares[i] = share;
            distributed += share;
        }

        // Last recipient absorbs all rounding dust so that sum(shares) == amount exactly.
        // distributed <= amount is guaranteed: each share = floor(amount * bps[i] / 10_000)
        // and sum(bps) = 10_000, so sum(floor(amount * bps[i] / 10_000)) <= amount.
        uint256 lastShare = amount - distributed;
        shares[len - 1] = lastShare;

        IERC20 token = IERC20(USDC);

        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        uint256 pushed = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (!token.transfer(recipients[i], shares[i])) revert TransferFailed();
            pushed += shares[i];
        }

        // Accounting invariant: every token pulled in must be pushed out.
        // Uses arithmetic, not balanceOf(), so unsolicited deposits cannot grief this call.
        if (pushed != amount) revert TransferFailed();

        emit PaymentSplit(msg.sender, amount, recipients, shares);
    }
}
