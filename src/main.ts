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
import sshpk from 'sshpk'
import { SshpkSigner } from '@data.pub/did-sshpk'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run() {
  try {
    const idInput = core.getInput('id')
    console.debug('was action: id input', { length: idInput?.length })

    let signer
    if (idInput) {
      try {
        const keyFromId = sshpk.parsePrivateKey(idInput)
        signer = await SshpkSigner.fromPrivateKey(keyFromId)
      } catch (error) {
        throw new Error(`Failed to parse id input as ssh key`, { cause: error })
      }
    }

    const urlInput = core.getInput('url')
    const storageUrl = new URL(
      urlInput || 'https://wallet-attached-storage.bengo.is'
    )

    const patternOfSpaceUrl =
      /\/space\/(?<spaceUuid>[^/]+)(?<path>\/(?<name>.*)?)?/
    const match = storageUrl.toString().match(patternOfSpaceUrl)
    if (!match) throw new Error('failed to parse url')
    const {
      spaceUuid = crypto.randomUUID(),
      path: pathOfResource,
      name
    } = match.groups ?? {}

    const keyToSpace =
      signer ??
      (console.debug('generating new ed25519 to be space controller'),
      await Ed25519Signer.generate())
    console.debug('using key to space', keyToSpace.id)

    const storageUrlOriginUrl = new URL(storageUrl.origin)
    console.debug('storage url', storageUrlOriginUrl.toString())
    const storage = new StorageClient(storageUrlOriginUrl)

    const space1 = storage.space({
      id: `urn:uuid:${spaceUuid}`,
      signer: keyToSpace
    })

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
      if (name === 'index.html' || name.endsWith('/index.html')) {
        // also PUT to the container/
        const nameOfContainer = name.replace(/index\.html$/, '')
        const resourceForContainer = space1.resource(nameOfContainer)
        core.info(`PUT ${resourceForContainer.path}`)
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
