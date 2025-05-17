/* eslint-disable @typescript-eslint/no-unused-vars */
import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { StorageClient } from '@wallet.storage/fetch-client'
import { Ed25519Signer } from '@did.coop/did-key-ed25519'
import assert from 'assert'
import { readFile } from 'fs/promises'
import { createReadStream, lstatSync } from 'fs'
import { blob } from 'stream/consumers'
import * as path from 'path'

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

    const filesStripPrefix = core.getInput('filesStripPrefix') ?? ''
    const globPattern = core.getInput('files') // Get glob pattern from input
    const globber = await glob.create(globPattern)
    const files = await globber.glob()

    console.debug('iterating files', { globPattern })

    let lastName
    for (const file of files) {
      const isDirectory = lstatSync(file).isDirectory()
      if (isDirectory) continue
      const relativeToCwd = path.relative(process.cwd(), file)
      console.debug('file', relativeToCwd)
      const relativeToCwdWithoutPrefix = relativeToCwd.replace(
        filesStripPrefix,
        ''
      )
      const name = relativeToCwdWithoutPrefix
      lastName = name
      const resourceWithName = space1.resource(name)
      core.info(`PUT ${resourceWithName.path}`)
      const fileContents = await blob(createReadStream(file))
      const responseToPut = await resourceWithName.put(fileContents)
      console.debug(
        `Response to PUT ${resourceWithName.path}: `,
        responseToPut.status,
        new URL(resourceWithName.path, storageUrl).toString()
      )

      // @todo: make this configurable
      if (name.endsWith('/index.html')) {
        // also PUT to the container/
        const nameOfContainer = name.replace(/index\.html$/, '')
        console.debug('nameOfContainer', nameOfContainer)
        const resourceForContainer = space1.resource(nameOfContainer)
        const responseToPutContainer =
          await resourceForContainer.put(fileContents)
        console.debug(
          `Response to PUT ${resourceForContainer.path}: `,
          responseToPutContainer.status,
          new URL(resourceForContainer.path, storageUrl).toString()
        )
      }
    }

    console.debug('iterated files')

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
    core.setOutput(
      'resource',
      new URL(
        `/space/${space1.uuid}/resource/${lastName}`,
        storageUrl
      ).toString()
    )
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
