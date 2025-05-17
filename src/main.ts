/* eslint-disable @typescript-eslint/no-unused-vars */
import * as core from '@actions/core'
import { StorageClient } from '@wallet.storage/fetch-client'
import { Ed25519Signer } from '@did.coop/did-key-ed25519'
import assert from 'assert'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run() {
  try {
    const ms = core.getInput('milliseconds')
    const urlInput = core.getInput('url')
    const storageUrl = new URL(
      urlInput || 'https://wallet-attached-storage.bengo.is'
    )

    const keyToSpace = await Ed25519Signer.generate()
    console.debug('keyToSpace', keyToSpace.controller)

    const storage = new StorageClient(storageUrl)

    const space1 = storage.space({
      signer: keyToSpace
    })
    const space1Index = space1.resource('')
    const responseToPutIndex = await space1Index.put(
      new Blob([JSON.stringify({ hello: 'world' })], {
        type: 'application/json'
      })
    )
    console.debug('responseToPutIndex', {
      status: responseToPutIndex.status,
      headers: responseToPutIndex.headers
    })
    assert.equal(responseToPutIndex.ok, true, 'response to PUT / MUST be ok')
    console.debug('index', new URL(space1Index.path, storageUrl).toString())

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
