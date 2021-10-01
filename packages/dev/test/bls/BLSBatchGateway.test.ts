import { toBN } from 'web3-utils'
import { HttpProvider } from 'web3-core'

import {
  BLSAddressAuthorisationsRegistrarInstance,
  BLSBatchGatewayInstance,
  BLSTestHubInstance,
  DomainSpecificInputDecompressorInstance
} from '@opengsn/contracts'
import { expectEvent, expectRevert } from '@openzeppelin/test-helpers'
import { RelayRequest } from '@opengsn/common/dist/EIP712/RelayRequest'
import { ApprovalItem, DecompressorInteractor, encodeBatch } from '@opengsn/common/dist/bls/DecompressorInteractor'
import { BLSTypedDataSigner } from '@opengsn/common/dist/bls/BLSTypedDataSigner'
import { configureGSN } from '../TestUtils'
import { AccountManager } from '@opengsn/provider/dist/AccountManager'
import { Address } from '@opengsn/common/dist/types/Aliases'

const BLSAddressAuthorisationsRegistrar = artifacts.require('BLSAddressAuthorisationsRegistrar')
const DomainSpecificInputDecompressor = artifacts.require('DomainSpecificInputDecompressor')
const BLSBatchGateway = artifacts.require('BLSBatchGateway')
const BLSTestHub = artifacts.require('BLSTestHub')

const blsPublicKey: string[] = [
  '0x2591180d099ddbc1b4cfcfaf2450dc0f054339950d461a88bdfe27d513268f3a',
  '0x0b5f4bda51133493803cd01f82b77ec9e20485f233136f0189f4873615b03c36',
  '0x103cb7ac4b0d13f4bab829a88f1303741673663077568953b30721054d822e27',
  '0x08cf151d45f98f4003bcad178e7188bdb62cca4858e8dd3dab63542b83240229'
]

async function createAuthorisationSignature (from: string, registrar: BLSAddressAuthorisationsRegistrarInstance): Promise<string> {
  const config = configureGSN({
    methodSuffix: '_v4',
    jsonStringifyRequest: false
  })
  const accountManager = new AccountManager(web3.currentProvider as HttpProvider, 1337, config)
  accountManager.setBLSKeypair({
    pubkey: blsPublicKey,
    secret: ''
  })
  return await accountManager.createAccountAuthorisation(from, registrar.address.toLowerCase())
}

contract.only('BLSBatchGateway', function ([from, to]: string[]) {
  let decompressorInteractor: DecompressorInteractor
  let blsTypedDataSigner: BLSTypedDataSigner

  let blsTestHub: BLSTestHubInstance
  let gateway: BLSBatchGatewayInstance
  let decompressor: DomainSpecificInputDecompressorInstance
  let registrar: BLSAddressAuthorisationsRegistrarInstance

  before(async function () {
    blsTestHub = await BLSTestHub.new()
    decompressor = await DomainSpecificInputDecompressor.new()
    registrar = await BLSAddressAuthorisationsRegistrar.new()
    gateway = await BLSBatchGateway.new(decompressor.address, registrar.address, blsTestHub.address)

    blsTypedDataSigner = new BLSTypedDataSigner({ keypair: await BLSTypedDataSigner.newKeypair() })
    decompressorInteractor = await new DecompressorInteractor({ provider: web3.currentProvider as HttpProvider })
      .init({ decompressorAddress: decompressor.address })
  })

  context('fallback function', function () {
    it('should accept empty batch and emit empty BatchRelayed event', async function () {
      const data = encodeBatch({
        maxAcceptanceBudget: toBN(15),
        blsSignature: [toBN(5), toBN(7)],
        items: []
      })
      const receipt = await web3.eth.sendTransaction({
        from,
        to: gateway.address,
        data
      }) as TransactionReceipt
      await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        relayWorker: from,
        accepted: '0',
        rejected: '0'
      })
    })

    it.only('should accept batch with a single element plus key approval and emit BatchRelayed event', async function () {
      // @ts-ignore
      const relayRequest: RelayRequest = {
        // @ts-ignore
        request: {
          from,
          to
        }
      }
      const batchItem = await decompressorInteractor.relayRequestToBatchItem(toBN(777), relayRequest)
      const authorisationSignature = await createAuthorisationSignature(from, registrar)
      const authorisationItem: ApprovalItem = {
        authoriser: from,
        blsPublicKey: blsPublicKey.map(it => { return toBN(it) }),
        signature: authorisationSignature
      }
      // await registrar.registerAddressAuthorisation(from, blsPublicKey, authorisationSignature)
      const data = encodeBatch({
        maxAcceptanceBudget: toBN(15),
        blsSignature: [toBN(5), toBN(7)],
        items: [batchItem],
        approvals: [authorisationItem]
      })
      const receipt = await web3.eth.sendTransaction({
        from,
        to: gateway.address,
        data
      }) as TransactionReceipt

      await expectEvent.inTransaction(receipt.transactionHash, BLSAddressAuthorisationsRegistrar, 'AuthorisationIssued', {
        authoriser: from
      })

      await expectEvent.inTransaction(receipt.transactionHash, BLSBatchGateway, 'BatchRelayed', {
        relayWorker: from,
        accepted: '1',
        rejected: '0'
      })

      await expectEvent.inTransaction(receipt.transactionHash, BLSTestHub, 'ReceivedRelayCall', {
        batchItemId: '777',
        requestFrom: from,
        requestTo: to
      })
    })

    // note: this test relies on a previous test to cache the elements
    it('should accept batch with a single element with compresses fields and emit BatchRelayed event', async function () {
    })

    it('should accept batch with multiple elements with different fields and emit BatchRelayed event', async function () {
    })

    it('should reject batch with a single element with an incorrect BLS signature', async function () {
      // @ts-ignore
      const relayRequest: RelayRequest = {
        // @ts-ignore
        request: {
          from,
          to
        }
      }

      // it seems that if the signature is not some BLS signature hardhat will revert the entire transaction
      const invalidBLSSignature = [
        toBN('0x0d0f7ffada69be42006ba9236c07b9ee3a13d43705e4cf006fb509542281fd78'),
        toBN('0x019049c5f410a54c9d85add908a921c75c3f8c94e8bcebdfafc5da8afec910dc')]
      const batchItem = await decompressorInteractor.relayRequestToBatchItem(toBN(777), relayRequest)
      const data = encodeBatch({
        maxAcceptanceBudget: toBN(15),
        blsSignature: blsTypedDataSigner.signTypedDataBLS().map(it => toBN(it.toString())), // TODO: converge on BN, probably
        items: [batchItem]
      })
      await expectRevert(web3.eth.call({
        from,
        to: gateway.address,
        data
      }), 'Error: VM Exception while processing transaction: reverted with reason string \'BLS signature verification failed\'')
    })

    it('should reject batch with multiple elements with an incorrect BLS aggregated signature', async function () {
    })
  })

  context('#decodeBatchItem()', function () {

  })
})
