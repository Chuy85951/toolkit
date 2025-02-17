import {info, warning, debug} from '@actions/core'
import {getOctokit} from '@actions/github'
import {ListArtifactsResponse, Artifact} from '../shared/interfaces'
import {getUserAgentString} from '../shared/user-agent'
import {getRetryOptions} from './retry-options'
import {defaults as defaultGitHubOptions} from '@actions/github/lib/utils'
import {requestLog} from '@octokit/plugin-request-log'
import {retry} from '@octokit/plugin-retry'
import {OctokitOptions} from '@octokit/core/dist-types/types'
import {internalArtifactTwirpClient} from '../shared/artifact-twirp-client'
import {getBackendIdsFromToken} from '../shared/util'
import {ListArtifactsRequest} from 'src/generated'

// Limiting to 1000 for perf reasons
const maximumArtifactCount = 1000
const paginationCount = 100
const maxNumberOfPages = maximumArtifactCount / paginationCount

export async function listArtifactsPublic(
  workflowRunId: number,
  repositoryOwner: string,
  repositoryName: string,
  token: string
): Promise<ListArtifactsResponse> {
  info(
    `Fetching artifact list for workflow run ${workflowRunId} in repository ${repositoryOwner}/${repositoryName}`
  )

  const artifacts: Artifact[] = []
  const [retryOpts, requestOpts] = getRetryOptions(defaultGitHubOptions)

  const opts: OctokitOptions = {
    log: undefined,
    userAgent: getUserAgentString(),
    previews: undefined,
    retry: retryOpts,
    request: requestOpts
  }

  const github = getOctokit(token, opts, retry, requestLog)

  let currentPageNumber = 1
  const {data: listArtifactResponse} =
    await github.rest.actions.listWorkflowRunArtifacts({
      owner: repositoryOwner,
      repo: repositoryName,
      run_id: workflowRunId,
      per_page: paginationCount,
      page: currentPageNumber
    })

  let numberOfPages = Math.ceil(
    listArtifactResponse.total_count / paginationCount
  )
  const totalArtifactCount = listArtifactResponse.total_count
  if (totalArtifactCount > maximumArtifactCount) {
    warning(
      `Workflow run ${workflowRunId} has more than 1000 artifacts. Results will be incomplete as only the first ${maximumArtifactCount} artifacts will be returned`
    )
    numberOfPages = maxNumberOfPages
  }

  // Iterate over the first page
  for (const artifact of listArtifactResponse.artifacts) {
    artifacts.push({
      name: artifact.name,
      id: artifact.id,
      size: artifact.size_in_bytes
    })
  }

  // Iterate over any remaining pages
  for (
    currentPageNumber;
    currentPageNumber < numberOfPages;
    currentPageNumber++
  ) {
    currentPageNumber++
    debug(`Fetching page ${currentPageNumber} of artifact list`)

    const {data: listArtifactResponse} =
      await github.rest.actions.listWorkflowRunArtifacts({
        owner: repositoryOwner,
        repo: repositoryName,
        run_id: workflowRunId,
        per_page: paginationCount,
        page: currentPageNumber
      })

    for (const artifact of listArtifactResponse.artifacts) {
      artifacts.push({
        name: artifact.name,
        id: artifact.id,
        size: artifact.size_in_bytes
      })
    }
  }

  info(`Found ${artifacts.length} artifact(s)`)

  return {
    artifacts
  }
}

export async function listArtifactsInternal(): Promise<ListArtifactsResponse> {
  const artifactClient = internalArtifactTwirpClient()

  const {workflowRunBackendId, workflowJobRunBackendId} =
    getBackendIdsFromToken()

  const req: ListArtifactsRequest = {
    workflowRunBackendId,
    workflowJobRunBackendId
  }

  const res = await artifactClient.ListArtifacts(req)
  const artifacts = res.artifacts.map(artifact => ({
    name: artifact.name,
    id: Number(artifact.databaseId),
    size: Number(artifact.size)
  }))

  info(`Found ${artifacts.length} artifact(s)`)

  return {
    artifacts
  }
}
