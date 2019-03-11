import winston from 'winston'
import fs from 'fs'
import process from 'process'

import { getDriverClass, logger } from './utils'

export enum DriverName { 
  aws = 'aws',
  azure = 'azure',
  disk = 'disk',
  'google-cloud' = 'google-cloud'
}

interface Config {
  serverName: string;
  port: number;
  driver?: DriverName;
  bucket: string;
  readURL: string & null;
  pageSize: number;
  requireCorrectHubUrl: boolean;
  cacheControl: string;
  whitelist: string[] & null,
  validHubUrls?: string[];
  proofsConfig?: { proofsRequired: number };
  argsTransport: {
      level: string;
      handleExceptions: boolean;
      stringify: boolean;
      timestamp: boolean;
      colorize: boolean;
      json: boolean;
  }
}

export const configDefaults: Config = {
  argsTransport: {
    level: 'warn',
    handleExceptions: true,
    timestamp: true,
    stringify: true,
    colorize: true,
    json: false
  },
  whitelist: null,
  readURL: null,
  driver: undefined,
  validHubUrls: undefined,
  requireCorrectHubUrl: false,
  serverName: 'gaia-0',
  bucket: 'hub',
  pageSize: 100,
  cacheControl: 'public, max-age=1',
  port: 3000,
  proofsConfig: undefined
}

const globalEnvVars = { whitelist: 'GAIA_WHITELIST',
                        readURL: 'GAIA_READ_URL',
                        driver: 'GAIA_DRIVER',
                        validHubUrls: 'GAIA_VALID_HUB_URLS',
                        requireCorrectHubUrl: 'GAIA_REQUIRE_CORRECT_HUB_URL',
                        serverName: 'GAIA_SERVER_NAME',
                        bucket: 'GAIA_BUCKET_NAME',
                        pageSize: 'GAIA_PAGE_SIZE',
                        cacheControl: 'GAIA_CACHE_CONTROL',
                        port: 'GAIA_PORT' }

const parseInts = [ 'port', 'pageSize', 'requireCorrectHubUrl' ]
const parseLists = [ 'validHubUrls', 'whitelist' ]

function getConfigEnv(envVars: {[key: string]: string}) {
  const configEnv: {[key: string]: any} = {}
  for (const name in envVars) {
    const envVar = envVars[name]
    if (process.env[envVar]) {
      console.log(process.env[envVar])
      configEnv[name] = process.env[envVar]
      if (parseInts.indexOf(name) >= 0) {
        configEnv[name] = parseInt(configEnv[name])
        if (isNaN(configEnv[name])) {
          throw new Error(`Passed a non-number input to: ${envVar}`)
        }
      } else if (parseLists.indexOf(name) >= 0) {
        configEnv[name] = (<string>configEnv[name]).split(',').map(x => x.trim())
      }
    }
  }
  return configEnv
}

// we deep merge so that if someone sets { field: {subfield: foo} }, it doesn't remove
//                                       { field: {subfieldOther: bar} }
function deepMerge<T>(target: T, ...sources: T[]): T {
  function isObject(item: any) {
    return (item && typeof item === 'object' && !Array.isArray(item))
  }

  if (sources.length === 0) {
    return target
  }

  const source = sources.shift()

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} })
        deepMerge(target[key], source[key])
      } else {
        Object.assign(target, { [key]: source[key] })
      }
    }
  }

  return deepMerge(target, ...sources)
}

export function getConfig() {
  const configPath = process.env.CONFIG_PATH || process.argv[2] || './config.json'
  let configJSON
  try {
    configJSON = JSON.parse(fs.readFileSync(configPath, { encoding: 'utf8' }))
  } catch (err) {
    configJSON = {}
  }

  if (configJSON.servername) {
    if (!configJSON.serverName) {
      configJSON.serverName = configJSON.servername
    }
    delete configJSON.servername
  }

  const configENV = getConfigEnv(globalEnvVars)

  const configGlobal = deepMerge({}, configDefaults, configJSON, configENV)

  let config = configGlobal
  if (config.driver) {
    const driverClass = getDriverClass(config.driver)
    const driverConfigInfo = driverClass.getConfigInformation()
    config = deepMerge({}, driverConfigInfo.defaults, configGlobal, driverConfigInfo.envVars)
  }

  logger.configure({ transports: [
    new winston.transports.Console(config.argsTransport) ] })

  return config
}

