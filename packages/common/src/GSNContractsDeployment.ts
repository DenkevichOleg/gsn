import { Address } from './types/Aliases'

export interface GSNContractsDeployment {
  forwarderAddress?: Address
  paymasterAddress?: Address
  penalizerAddress?: Address
  relayHubAddress?: Address
  stakeManagerAddress?: Address
  versionRegistryAddress?: Address
}

export interface GSNBatchingContractsDeployment {
  batchGateway: Address
  batchGatewayCacheDecoder: Address
  authorizationsRegistrar: Address
}
