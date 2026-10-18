/**
 * Mock EIP-1193 wallet injected into the page via page.addInitScript().
 *
 * Design:
 * - Exposes window.__mockWallet for test-side control.
 * - Implements the minimal EIP-1193 provider interface wagmi/ConnectKit uses.
 * - All RPC responses are programmable per-call via window.__mockWallet.setHandler().
 * - Default state: disconnected, no chain.
 *
 * Usage in tests (page.addInitScript):
 *   await page.addInitScript({ path: require.resolve('./mockWallet.js') })
 *
 * Control from test code (page.evaluate):
 *   await page.evaluate(() => window.__mockWallet.connect({ chainId: '0x13b2' }))
 *   await page.evaluate(() => window.__mockWallet.setNextTxHash('0xabc...'))
 *   await page.evaluate(() => window.__mockWallet.rejectNext('User rejected'))
 *   await page.evaluate(() => window.__mockWallet.setChainId('0x1'))
 */

// ──────────────────────────────────────────────────────────────────────────────
// These types describe the shape injected into window — used only at test-file
// compile time (imported as a type), never bundled into the app itself.
// ──────────────────────────────────────────────────────────────────────────────
export interface MockWalletControl {
  /** Connect the wallet with a given hex chainId (e.g. '0x13b2' for Arc mainnet 5042) */
  connect(opts: { address?: string; chainId: string }): void
  /** Disconnect the wallet */
  disconnect(): void
  /** Set the chainId without reconnecting (simulates chain switch) */
  setChainId(hexChainId: string): void
  /** Next eth_sendTransaction will return this hash */
  setNextTxHash(hash: string): void
  /** Next eth_sendTransaction / eth_requestAccounts will reject with this message */
  rejectNext(message: string): void
  /** Set the eth_call response for a specific function selector (first 4 bytes of data, hex) */
  setCallResponse(selector: string, hexResult: string): void
  /** Set the receipt for a given hash — isSuccess controls transactionIndex bit */
  setReceipt(hash: string, opts: { status: '0x1' | '0x0'; blockNumber?: string }): void
  /** Raw override for any RPC method */
  setRpcOverride(method: string, result: unknown): void
  clearOverrides(): void
  /** Current connected address */
  address: string | undefined
  /** Current hex chainId */
  chainId: string | undefined
}

declare global {
  interface Window {
    __mockWallet: MockWalletControl
    ethereum: {
      isMetaMask?: boolean
      request(args: { method: string; params?: unknown[] }): Promise<unknown>
      on(event: string, handler: (...args: unknown[]) => void): void
      removeListener(event: string, handler: (...args: unknown[]) => void): void
      selectedAddress: string | null
      chainId: string | null
    }
  }
}

// This function is serialised and injected into the browser page. It must be
// self-contained — no imports, no closures over external variables.
export function buildMockWalletScript(): string {
  return `
(function () {
  // ── State ──────────────────────────────────────────────────────────────────
  let _address = undefined;
  let _chainId = undefined;           // hex string, e.g. '0x13b2'
  let _connected = false;
  let _nextTxHash = undefined;
  let _rejectMessage = undefined;
  let _callOverrides = {};            // selector -> hex result
  let _receiptMap = {};               // hash -> { status, blockNumber }
  let _rpcOverrides = {};             // method -> result
  let _eventListeners = {};

  function emit(event) {
    const args = Array.prototype.slice.call(arguments, 1);
    const handlers = _eventListeners[event] || [];
    handlers.forEach(function(h) { try { h.apply(null, args); } catch(e) {} });
  }

  // ── EIP-1193 provider ──────────────────────────────────────────────────────
  const provider = {
    isMetaMask: true,
    selectedAddress: null,
    chainId: null,

    on: function(event, handler) {
      if (!_eventListeners[event]) _eventListeners[event] = [];
      _eventListeners[event].push(handler);
    },
    removeListener: function(event, handler) {
      if (!_eventListeners[event]) return;
      _eventListeners[event] = _eventListeners[event].filter(function(h) { return h !== handler; });
    },

    request: function(args) {
      const method = args.method;
      const params = args.params || [];

      // Check RPC overrides first
      if (_rpcOverrides.hasOwnProperty(method)) {
        const v = _rpcOverrides[method];
        return Promise.resolve(v);
      }

      // eth_requestAccounts — wallet connect prompt
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        if (_rejectMessage) {
          const msg = _rejectMessage;
          _rejectMessage = undefined;
          return Promise.reject({ code: 4001, message: msg });
        }
        if (!_connected) {
          if (method === 'eth_accounts') return Promise.resolve([]);
          return Promise.reject({ code: 4001, message: 'User rejected' });
        }
        return Promise.resolve(_address ? [_address] : []);
      }

      // eth_chainId
      if (method === 'eth_chainId') {
        return Promise.resolve(_chainId || '0x1');
      }

      // wallet_addEthereumChain — wagmi issues this when the chain isn't in the wallet yet
      if (method === 'wallet_addEthereumChain') {
        if (_rejectMessage) {
          const msg = _rejectMessage;
          _rejectMessage = undefined;
          return Promise.reject({ code: 4001, message: msg });
        }
        const reqChain = params[0] && params[0].chainId;
        if (reqChain) {
          _chainId = reqChain;
          provider.chainId = reqChain;
          emit('chainChanged', reqChain);
        }
        return Promise.resolve(null);
      }

      // wallet_switchEthereumChain
      if (method === 'wallet_switchEthereumChain') {
        if (_rejectMessage) {
          const msg = _rejectMessage;
          _rejectMessage = undefined;
          return Promise.reject({ code: 4001, message: msg });
        }
        const reqChain = params[0] && params[0].chainId;
        if (reqChain) {
          _chainId = reqChain;
          provider.chainId = reqChain;
          emit('chainChanged', reqChain);
        }
        return Promise.resolve(null);
      }

      // eth_sendTransaction
      if (method === 'eth_sendTransaction') {
        if (_rejectMessage) {
          const msg = _rejectMessage;
          _rejectMessage = undefined;
          return Promise.reject({ code: 4001, message: msg });
        }
        const hash = _nextTxHash || ('0x' + Array(64).fill(0).map(function(_,i){ return ((i*7+3)%16).toString(16); }).join(''));
        _nextTxHash = undefined;
        return Promise.resolve(hash);
      }

      // eth_getTransactionReceipt
      if (method === 'eth_getTransactionReceipt') {
        const hash = params[0];
        if (_receiptMap[hash]) {
          const r = _receiptMap[hash];
          return Promise.resolve({
            transactionHash: hash,
            blockNumber: r.blockNumber || '0x1',
            blockHash: '0xblockhash',
            status: r.status,
            gasUsed: '0x5208',
            logs: [],
          });
        }
        // Return null first (pending), then receipt on second poll
        // Track poll count per hash
        if (!provider._pollCount) provider._pollCount = {};
        provider._pollCount[hash] = (provider._pollCount[hash] || 0) + 1;
        if (provider._pollCount[hash] >= 2) {
          // Auto-succeed after 2 polls
          return Promise.resolve({
            transactionHash: hash,
            blockNumber: '0x1',
            blockHash: '0xblockhash',
            status: '0x1',
            gasUsed: '0x5208',
            logs: [],
          });
        }
        return Promise.resolve(null);
      }

      // eth_getTransactionByHash — needed by some wagmi internals
      if (method === 'eth_getTransactionByHash') {
        return Promise.resolve({
          hash: params[0],
          blockNumber: '0x1',
          from: _address || '0x0000000000000000000000000000000000000001',
          to: '0x0000000000000000000000000000000000000002',
          value: '0x0',
          input: '0x',
        });
      }

      // eth_call (ERC-20 balanceOf, allowance)
      if (method === 'eth_call') {
        const callData = params[0] && params[0].data;
        const selector = callData && callData.slice(0, 10);
        if (selector && _callOverrides[selector] !== undefined) {
          return Promise.resolve(_callOverrides[selector]);
        }
        // Default: balanceOf -> 1000 USDC (1_000_000_000 in 6-decimal micro), allowance -> 0
        // balanceOf selector: 0x70a08231
        if (selector === '0x70a08231') {
          return Promise.resolve('0x' + '000000000000000000000000000000000000000000000000000000003b9aca00'); // 1_000_000_000 = 1000 USDC
        }
        // allowance selector: 0xdd62ed3e
        if (selector === '0xdd62ed3e') {
          return Promise.resolve('0x' + '0000000000000000000000000000000000000000000000000000000000000000');
        }
        return Promise.resolve('0x');
      }

      // eth_blockNumber
      if (method === 'eth_blockNumber') {
        return Promise.resolve('0x1');
      }

      // net_version
      if (method === 'net_version') {
        return Promise.resolve(_chainId ? parseInt(_chainId, 16).toString() : '1');
      }

      // eth_getBalance (native)
      if (method === 'eth_getBalance') {
        return Promise.resolve('0x0');
      }

      // eth_estimateGas
      if (method === 'eth_estimateGas') {
        return Promise.resolve('0x5208');
      }

      // eth_gasPrice / eth_feeHistory
      if (method === 'eth_gasPrice') return Promise.resolve('0x3b9aca00');
      if (method === 'eth_maxPriorityFeePerGas') return Promise.resolve('0x3b9aca00');
      if (method === 'eth_feeHistory') return Promise.resolve({ baseFeePerGas: ['0x1'], gasUsedRatio: [0.5], oldestBlock: '0x1', reward: [['0x1']] });

      // Default passthrough — return empty
      return Promise.resolve(null);
    }
  };

  // ── Control API (test-side) ────────────────────────────────────────────────
  window.__mockWallet = {
    get address() { return _address; },
    get chainId() { return _chainId; },

    connect: function(opts) {
      _address = opts.address || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
      _chainId = opts.chainId;
      _connected = true;
      provider.selectedAddress = _address;
      provider.chainId = _chainId;
      emit('accountsChanged', [_address]);
      emit('chainChanged', _chainId);
    },

    disconnect: function() {
      _address = undefined;
      _connected = false;
      provider.selectedAddress = null;
      emit('accountsChanged', []);
    },

    setChainId: function(hexChainId) {
      _chainId = hexChainId;
      provider.chainId = hexChainId;
      emit('chainChanged', hexChainId);
    },

    setNextTxHash: function(hash) {
      _nextTxHash = hash;
    },

    rejectNext: function(message) {
      _rejectMessage = message || 'User rejected the request.';
    },

    setCallResponse: function(selector, hexResult) {
      _callOverrides[selector] = hexResult;
    },

    setReceipt: function(hash, opts) {
      _receiptMap[hash] = opts;
    },

    setRpcOverride: function(method, result) {
      _rpcOverrides[method] = result;
    },

    clearOverrides: function() {
      _callOverrides = {};
      _receiptMap = {};
      _rpcOverrides = {};
      _nextTxHash = undefined;
      _rejectMessage = undefined;
    },
  };

  // Inject before wagmi/ConnectKit initialize
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    writable: true,
    configurable: true,
  });
})();
`
}
