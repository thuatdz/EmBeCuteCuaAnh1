// Bot Types và Interfaces
export interface BotConfig {
  host: string
  port: number
  username: string
  version: string
  auth: 'microsoft' | 'offline'
}

export interface BotState {
  targetPlayer: any
  isFollowing: boolean
  isProtecting: boolean
  autoFarmActive: boolean
  autoFishingActive: boolean
  autoMiningActive: boolean
  autoChestActive: boolean
  autoBuildActive: boolean
  isEating: boolean
  isCurrentlyDigging: boolean
  itemCollectionDisabled: boolean
  autoItemCollectionDisabled: boolean
  autoEquipDisabled: boolean
}

export interface MiningState {
  targetOreType: string
  currentMiningTarget: any
  lastMinedPosition: any
  searchDepthLevel: number
  explorationHistory: Array<{x: number, y: number, z: number}>
  consecutiveFailedSearches: number
  netheriteFoundCount: number
  lastNetheriteFoundTime: number
}

export interface FishingState {
  isFishing: boolean
  currentHook: any
  fishingStartTime: number
  hasFishBitten: boolean
  lastHookPosition: any
  bobberThrowCount: number
}

export interface ChestState {
  currentChestTarget: any
  foundChestHistory: Set<string>
  chestSearchDepthLevel: number
  chestExplorationHistory: Array<{x: number, y: number, z: number}>
  consecutiveFailedChestSearches: number
}

export interface BuildState {
  currentBuildProject: any
  buildProgress: number
}

export interface RespawnState {
  lastMode: string
  lastPosition: any
  lastTargetPlayerName: string
  hasTpPermission: boolean | null
  tpFailCount: number
}