/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register RPC URLs so trace events show correct chain names
registerChain(arc.id, arc.rpcUrls.default.http[0])
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arc, arcTestnet, mainnet],
  connectors: [injected()],
  transports: {
    [arc.id]: http(),           // Arc Mainnet — real USDC
    [arcTestnet.id]: http(),    // Arc Testnet  — test USDC
    [mainnet.id]: http(),       // Ethereum mainnet — ENS only
  },
})

// Arc Mainnet chain ID, exported so components can reference it without
// importing the full viem chain object.
export const ARC_MAINNET_ID = arc.id       // 5042
export const ARC_TESTNET_ID = arcTestnet.id // 5042002
