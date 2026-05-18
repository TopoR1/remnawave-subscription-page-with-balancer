import { readFile } from 'node:fs/promises';

import type { ToporBalancerConfig } from './types';

import { validateToporBalancerConfig } from './topor-balancer-config.validator';

export async function loadToporBalancerConfigFromFile(
    configPath: string,
): Promise<ToporBalancerConfig> {
    const rawConfig = await readFile(configPath, 'utf8');

    return parseToporBalancerConfig(rawConfig);
}

export function parseToporBalancerConfig(rawConfig: string): ToporBalancerConfig {
    return validateToporBalancerConfig(JSON.parse(rawConfig));
}
