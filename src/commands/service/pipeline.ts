import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { BuildDefinition } from "azure-devops-node-api/interfaces/BuildInterfaces";
import commander from "commander";
import path from "path";
import { Config } from "../../config";
import {
  getOriginUrl,
  getRepositoryName,
  getRepositoryUrl
} from "../../lib/gitutils";
import {
  createPipelineForDefinition,
  definitionForAzureRepoPipeline,
  getBuildApiClient,
  queueBuild
} from "../../lib/pipelines/pipelines";
import { logger } from "../../logger";

export const createPipelineCommandDecorator = (
  command: commander.Command
): void => {
  command
    .command("create-pipeline <service-name>")
    .alias("p")
    .description("Configure Azure DevOps for a bedrock managed service.")
    .option(
      "-n, --pipeline-name <pipeline-name>",
      "Name of the pipeline to be created"
    )
    .option(
      "-p, --personal-access-token <personal-access-token>",
      "Personal Access Token"
    )
    .option("-o, --org-name <org-name>", "Organization Name for Azure DevOps")
    .option("-r, --repo-name <repo-name>", "Repository Name in Azure DevOps")
    .option("-u, --repo-url <repo-url>", "Repository URL")
    .option("-d, --devops-project <devops-project>", "Azure DevOps Project")
    .option(
      "-l, --packages-dir <packages-dir>",
      "The mono-repository directory containing this service definition. ie. '--packages-dir packages' if my-service is located under ./packages/my-service. Omitting this option implies this is a not a mono-repository."
    )
    .action(async (serviceName, opts) => {
      const gitOriginUrl = await getOriginUrl();

      const { azure_devops } = Config();
      const {
        orgName = azure_devops && azure_devops.org,
        personalAccessToken = azure_devops && azure_devops.access_token,
        devopsProject = azure_devops && azure_devops.project,
        pipelineName = serviceName + "-pipeline",
        packagesDir, // allow to be undefined in the case of a mono-repo
        repoName = getRepositoryName(gitOriginUrl),
        repoUrl = getRepositoryUrl(gitOriginUrl)
      } = opts;

      logger.debug(`orgName: ${orgName}`);
      logger.debug(`personalAccessToken: ${personalAccessToken}`);
      logger.debug(`devopsProject: ${devopsProject}`);
      logger.debug(`pipelineName: ${pipelineName}`);
      logger.debug(`packagesDir: ${packagesDir}`);
      logger.debug(`repoName: ${repoName}`);
      logger.debug(`repoUrl: ${repoUrl}`);

      try {
        if (typeof pipelineName !== "string") {
          throw new Error(
            `--pipeline-name must be of type 'string', ${typeof pipelineName} given.`
          );
        }

        if (typeof personalAccessToken !== "string") {
          throw new Error(
            `--personal-access-token must be of type 'string', ${typeof personalAccessToken} given.`
          );
        }

        if (typeof orgName !== "string") {
          throw new Error(
            `--org-url must be of type 'string', ${typeof orgName} given.`
          );
        }

        if (typeof repoName !== "string") {
          throw new Error(
            `--repo-name must be of type 'string', ${typeof repoName} given.`
          );
        }

        if (typeof repoUrl !== "string") {
          throw new Error(
            `--repo-url must be of type 'string', ${typeof repoUrl} given.`
          );
        }

        if (typeof devopsProject !== "string") {
          throw new Error(
            `--devops-project must be of type 'string', ${typeof devopsProject} given.`
          );
        }
      } catch (err) {
        logger.error(`Error occurred validating inputs for ${serviceName}`);
        logger.error(err);
        process.exit(1);
      }

      try {
        await installPipeline(
          serviceName,
          orgName,
          personalAccessToken,
          pipelineName,
          repoName,
          repoUrl,
          devopsProject,
          packagesDir,
          process.exit
        );
      } catch (err) {
        logger.error(`Error occurred installing pipeline for ${serviceName}`);
        logger.error(err);
        process.exit(1);
      }
    });
};

/**
 * Install a pipeline for the service in an azure devops org.
 *
 * @param serviceName Name of the service this pipeline belongs to; this is only used when `packagesDir` is defined as a means to locate the azure-pipelines.yaml file
 * @param orgName
 * @param personalAccessToken
 * @param pipelineName
 * @param repositoryName
 * @param repositoryUrl
 * @param project
 * @param packagesDir The directory containing the services for a mono-repo. If undefined; implies that we are operating on a standard service repository
 * @param exitFn
 */
export const installPipeline = async (
  serviceName: string,
  orgName: string,
  personalAccessToken: string,
  pipelineName: string,
  repositoryName: string,
  repositoryUrl: string,
  project: string,
  packagesDir: string | undefined,
  exitFn: (status: number) => void
) => {
  let devopsClient: IBuildApi | undefined;
  let builtDefinition: BuildDefinition | undefined;

  try {
    devopsClient = await getBuildApiClient(orgName, personalAccessToken);
    logger.info("Fetched DevOps Client");
  } catch (err) {
    logger.error(err);
    return exitFn(1);
  }

  const definition = definitionForAzureRepoPipeline({
    branchFilters: ["master"],
    maximumConcurrentBuilds: 1,
    /* tslint:disable-next-line object-literal-shorthand */
    pipelineName,
    repositoryName,
    repositoryUrl,
    yamlFileBranch: "master",
    yamlFilePath: packagesDir // if a packages dir is supplied, its a mono-repo
      ? path.join(packagesDir, serviceName, "azure-pipelines.yaml") // if a packages dir is supplied, its a mono-repo; concat <packages-dir>/<service-name>
      : "azure-pipelines.yaml" // if no packages dir, its a standard repo; so the azure-pipelines.yaml is in the root
  });

  try {
    logger.debug(
      `Creating pipeline for project '${project}' with definition '${JSON.stringify(
        definition
      )}'`
    );
    builtDefinition = await createPipelineForDefinition(
      devopsClient,
      project,
      definition
    );
  } catch (err) {
    logger.error(`Error occurred during pipeline creation for ${pipelineName}`);
    logger.error(err);
    return exitFn(1);
  }
  if (typeof builtDefinition.id === "undefined") {
    const builtDefnString = JSON.stringify(builtDefinition);
    throw Error(
      `Invalid BuildDefinition created, parameter 'id' is missing from ${builtDefnString}`
    );
  }

  logger.info(`Created pipeline for ${pipelineName}`);
  logger.info(`Pipeline ID: ${builtDefinition.id}`);

  try {
    await queueBuild(devopsClient, project, builtDefinition.id);
  } catch (err) {
    logger.error(`Error occurred when queueing build for ${pipelineName}`);
    logger.error(err);
    return exitFn(1);
  }
};
