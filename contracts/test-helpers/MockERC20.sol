// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockERC20
 * @dev Minimal ERC-20 mock for unit tests. Supports:
 *   - mint / burn
 *   - approve / transferFrom / transfer with standard bool returns
 *   - configurable decimals
 *   - optional reentrancy payload on transfer (for reentrancy test)
 */
contract MockERC20 {
    string public name;
    string public symbol;
    uint8  public decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    // Reentrancy hook: if set, the mock calls this target+calldata on every transfer().
    address public reentrantTarget;
    bytes   public reentrantCalldata;
    bool    private _reentrantArmed;  // prevent infinite recursion

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name     = _name;
        symbol   = _symbol;
        decimals = _decimals;
    }

    // ─── ERC-20 ────────────────────────────────────────────────────────────────

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;

        // Fire reentrancy hook ONLY when `to` is the armed target (once only).
        if (reentrantTarget != address(0) && to == reentrantTarget && !_reentrantArmed) {
            _reentrantArmed = true;
            // slither-disable-next-line unused-return
            reentrantTarget.call(reentrantCalldata);
            _reentrantArmed = false;
        }

        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount,               "MockERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount,   "MockERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        return true;
    }

    // ─── Helpers for tests ────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "MockERC20: insufficient balance");
        balanceOf[from] -= amount;
        totalSupply     -= amount;
    }

    /// @dev Arm the reentrancy hook: on the NEXT transfer() call the mock will
    ///      call `target` with `data` once (one level deep, then disarms).
    function armReentrancy(address target, bytes calldata data) external {
        reentrantTarget   = target;
        reentrantCalldata = data;
    }

    function disarmReentrancy() external {
        reentrantTarget   = address(0);
        reentrantCalldata = "";
    }
}
