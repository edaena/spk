import { getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import {
  AgentPoolQueue,
  Build,
  BuildDefinition,
  BuildDefinitionVariable,
  BuildRepository,
  ContinuousIntegrationTrigger,
  DefinitionQuality,
  DefinitionQueueStatus,
  DefinitionTriggerType,
  DefinitionType,
  YamlProcess
} from "azure-devops-node-api/interfaces/BuildInterfaces";
import { logger } from "../../logger";
import { azdoUrl } from "../azdoutil";

const hostedUbuntuPool = "Hosted Ubuntu 1604";
const hostedUbuntuPoolId = 224;

/**
 * Enum of Repository Provider types.
 */
export enum RepositoryTypes {
  Github = "github",
  Azure = "tfsgit"
}

/**
 * Get an Azure DevOps Build API Client
 * @param org An Azure DevOps Organization Name
 * @param token A Personal Access Token (PAT) used to authenticate against DevOps.
 * @returns BuildApi Client for Azure Devops
 */
export const getBuildApiClient = async (
  orgName: string,
  personalAccessToken: string
): Promise<IBuildApi> => {
  return initBuildApiClient(
    getPersonalAccessTokenHandler,
    WebApi,
    orgName,
    personalAccessToken
  );
};

export const initBuildApiClient = async (
  tokenHandler: (n: string) => any,
  webapi: typeof WebApi,
  orgName: string,
  token: string
): Promise<IBuildApi> => {
  const authHandler = tokenHandler(token);
  const orgUrl = azdoUrl(orgName);
  const connection = new webapi(orgUrl, authHandler);

  return connection.getBuildApi();
};

interface IPipeline {
  pipelineName: string;
  repositoryUrl: string;
  repositoryName: string;
  yamlFileBranch: string;
  yamlFilePath: string;
  branchFilters: string[];
  maximumConcurrentBuilds: number;
  variables?: {
    [key: string]: BuildDefinitionVariable;
  };
}

/**
 * Interface that describes a Pipeline Configuration for an Azure DevOps
 * backed git repository.
 */
// tslint:disable-next-line: no-empty-interface
export interface IAzureRepoPipelineConfig extends IPipeline {}

/**
 * Interface that describes a Pipeline Configuration for a GitHub backed
 * git repository.
 */
export interface IGithubRepoPipelineConfig extends IPipeline {
  serviceConnectionId: string;
}

/**
 * Generate a Build Definition given an Azure Repo Pipeline Configuration
 * @param pipelineConfig Object conforming to IAzureRepoPipelineConfig that describes a high level pipeline configuration for repositories backed on Azure Repos
 * @returns A BuildDefinition that can be consumed by a Build API Client
 */
export const definitionForAzureRepoPipeline = (
  pipelineConfig: IAzureRepoPipelineConfig
): BuildDefinition => {
  const pipelineDefinition: BuildDefinition = {};

  pipelineDefinition.badgeEnabled = true;
  pipelineDefinition.triggers = [
    {
      batchChanges: false,
      branchFilters: pipelineConfig.branchFilters,
      maxConcurrentBuildsPerBranch: pipelineConfig.maximumConcurrentBuilds,
      settingsSourceType: 2,
      triggerType: DefinitionTriggerType.ContinuousIntegration
    } as ContinuousIntegrationTrigger
  ];

  pipelineDefinition.queue = {
    name: hostedUbuntuPool,
    pool: {
      id: hostedUbuntuPoolId,
      name: hostedUbuntuPool
    }
  } as AgentPoolQueue;

  pipelineDefinition.queueStatus = DefinitionQueueStatus.Enabled;

  pipelineDefinition.name = pipelineConfig.pipelineName;
  pipelineDefinition.type = DefinitionType.Build;
  pipelineDefinition.quality = DefinitionQuality.Definition;

  pipelineDefinition.repository = {
    defaultBranch: pipelineConfig.yamlFileBranch,
    id: pipelineConfig.repositoryName,
    name: pipelineConfig.repositoryName,
    type: RepositoryTypes.Azure,
    url: pipelineConfig.repositoryUrl
  } as BuildRepository;

  pipelineDefinition.process = {
    yamlFilename: pipelineConfig.yamlFilePath
  } as YamlProcess;

  if (pipelineConfig.variables) {
    pipelineDefinition.variables = pipelineConfig.variables;
  }

  return pipelineDefinition;
};

/**
 * Generate a Build Definition given a GitHub Repo Pipeline Configuration
 * @param pipelineConfig Object conforming to IGithubRepoPipelineConfig that describes a high level pipeline configuration for repositories backed on Github
 * @returns A BuildDefinition that can be consumed by a Build API Client
 */
export const definitionForGithubRepoPipeline = (
  pipelineConfig: IGithubRepoPipelineConfig
): BuildDefinition => {
  const pipelineDefinition: BuildDefinition = {} as BuildDefinition;

  pipelineDefinition.badgeEnabled = true;
  pipelineDefinition.triggers = [
    {
      batchChanges: false,
      branchFilters: pipelineConfig.branchFilters,
      maxConcurrentBuildsPerBranch: pipelineConfig.maximumConcurrentBuilds,
      settingsSourceType: 2,
      triggerType: DefinitionTriggerType.ContinuousIntegration
    } as ContinuousIntegrationTrigger
  ];

  pipelineDefinition.queue = {
    name: hostedUbuntuPool,
    pool: {
      id: hostedUbuntuPoolId,
      name: hostedUbuntuPool
    }
  } as AgentPoolQueue;

  pipelineDefinition.queueStatus = DefinitionQueueStatus.Enabled;

  pipelineDefinition.name = pipelineConfig.pipelineName;
  pipelineDefinition.type = DefinitionType.Build;
  pipelineDefinition.quality = DefinitionQuality.Definition;

  pipelineDefinition.repository = {
    defaultBranch: pipelineConfig.yamlFileBranch,
    id: pipelineConfig.repositoryName,
    name: pipelineConfig.repositoryName,
    properties: {
      connectedServiceId: pipelineConfig.serviceConnectionId
    },
    type: RepositoryTypes.Github,
    url: pipelineConfig.repositoryUrl
  } as BuildRepository;

  pipelineDefinition.process = {
    yamlFilename: pipelineConfig.yamlFilePath
  } as YamlProcess;

  if (pipelineConfig.variables) {
    pipelineDefinition.variables = pipelineConfig.variables;
  }

  return pipelineDefinition;
};

/**
 * Create a Pipeline with on Azure Devops.
 * @param buildApi BuildApi Client for Azure Devops.
 * @param azdoProject Azure DevOps Project within the authenticated Organization.
 * @param definition A BuildDefinition that can be consumed by a Build API Client
 * @returns The BuildDefinition that was created by the Build API Client
 */
export const createPipelineForDefinition = async (
  buildApi: IBuildApi,
  azdoProject: string,
  definition: BuildDefinition
): Promise<BuildDefinition> => {
  logger.info("Creating pipeline for definition");

  try {
    logger.debug(
      `Creating BuildDefinition based on ${JSON.stringify(definition)}`
    );
    const createdDefn = await buildApi.createDefinition(
      definition,
      azdoProject
    );
    // type definition for createDefinition is wrong. It will resolve a `null` if an error occurs in azdo
    if (!createdDefn) {
      throw Error(
        `Error creating BuildDefinition; buildApi.createDefinition() returned an invalid value of ${createdDefn}`
      );
    }
    return createdDefn;
  } catch (e) {
    logger.error(e);
    throw Error("Error creating definition");
  }
};

/**
 * Queue a build on a pipeline.
 * @param buildApi BuildApi Client for Azure Devops
 * @param azdoProject Azure DevOps Project within the authenticated Organization.
 * @param definitionId A Build Definition ID.
 * @returns Build object that was created by the Build API Clients
 */
export const queueBuild = async (
  buildApi: IBuildApi,
  azdoProject: string,
  definitionId: number
): Promise<Build> => {
  const buildReference: Build = {
    definition: {
      id: definitionId
    }
  };

  try {
    return await buildApi.queueBuild(buildReference, azdoProject);
  } catch (e) {
    logger.error(e);
    throw Error("Error queueing build");
  }
};
