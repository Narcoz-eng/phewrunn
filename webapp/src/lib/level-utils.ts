// Level UI utility functions
// Color coding and labels for user levels

export interface LevelColors {
  bg: string;
  text: string;
  border: string;
  glow?: string;
}

/**
 * Get color classes for a given level
 * - Gold (Elite): level >= 8
 * - Silver (Veteran): level >= 4
 * - Bronze (Rising): level >= 1
 * - Pale Red (At Risk): level >= -2
 * - Deep Red (Liquidated): level < -2
 */
export function getLevelColor(level: number): LevelColors {
  if (level >= 8) {
    return {
      bg: 'bg-amber-500/20',
      text: 'text-amber-400',
      border: 'border-amber-500',
      glow: 'shadow-[0_0_12px_rgba(245,158,11,0.4)]',
    };
  }
  if (level >= 4) {
    return {
      bg: 'bg-slate-300/20',
      text: 'text-slate-300',
      border: 'border-slate-400',
      glow: 'shadow-[0_0_12px_rgba(148,163,184,0.4)]',
    };
  }
  if (level >= 1) {
    return {
      bg: 'bg-orange-700/20',
      text: 'text-orange-500',
      border: 'border-orange-600',
      glow: 'shadow-[0_0_12px_rgba(234,88,12,0.3)]',
    };
  }
  if (level >= -2) {
    return {
      bg: 'bg-red-500/10',
      text: 'text-red-300',
      border: 'border-red-400',
      glow: 'shadow-[0_0_10px_rgba(239,68,68,0.2)]',
    };
  }
  // level < -2 (danger/liquidation zone)
  return {
    bg: 'bg-red-600/20',
    text: 'text-red-500',
    border: 'border-red-600',
    glow: 'shadow-[0_0_15px_rgba(220,38,38,0.5)]',
  };
}

/**
 * Get the label/title for a given level
 */
export function getLevelLabel(level: number): string {
  if (level >= 8) return 'Elite';
  if (level >= 4) return 'Veteran';
  if (level >= 1) return 'Rising';
  if (level >= -2) return 'At Risk';
  return 'Liquidated';
}

/**
 * Check if user is in danger zone (level -3 or -4)
 */
export function isInDangerZone(level: number): boolean {
  return level === -3 || level === -4;
}

/**
 * Check if user is liquidated (level -5)
 */
export function isLiquidated(level: number): boolean {
  return level <= -5;
}

/**
 * Get warning message for dangerous levels
 */
export function getDangerMessage(level: number): string | null {
  if (level === -5) {
    return 'LIQUIDATED - You cannot post new alphas until your level improves.';
  }
  if (level === -4) {
    return 'CRITICAL - One more loss will result in liquidation!';
  }
  if (level === -3) {
    return 'WARNING - Your reputation is dangerously low.';
  }
  return null;
}

/**
 * Calculate progress to next level (or out of danger zone if negative)
 * Returns a value between 0 and 100
 */
export function getLevelProgress(level: number, xp: number): number {
  // XP thresholds per level (simplified)
  const xpPerLevel = 100;

  if (level < 0) {
    // For negative levels, show progress toward 0
    // Assume each level needs 100 XP to advance
    const xpNeeded = Math.abs(level) * xpPerLevel;
    const currentProgress = xp % xpPerLevel;
    return (currentProgress / xpPerLevel) * 100;
  }

  // For positive levels, show progress to next level
  const currentLevelXp = xp % xpPerLevel;
  return (currentLevelXp / xpPerLevel) * 100;
}
