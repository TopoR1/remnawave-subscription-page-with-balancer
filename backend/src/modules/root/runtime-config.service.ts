import { Request } from 'express';

import { Injectable, Logger } from '@nestjs/common';

import { TSubscriptionPageRawConfig } from '@remnawave/subscription-page-types';

import { IJwtPayload } from '@common/constants';

import { SubpageConfigService } from './subpage-config.service';

const FALLBACK_TRANSLATIONS = {
    active: { en: 'Active', ru: 'Активна' },
    bandwidth: { en: 'Bandwidth', ru: 'Трафик' },
    connectionKeysHeader: { en: 'Connection keys', ru: 'Ключи подключения' },
    copyLink: { en: 'Copy link', ru: 'Скопировать ссылку' },
    expired: { en: 'Expired', ru: 'Истекла' },
    expires: { en: 'Expires', ru: 'Истекает' },
    expiresIn: { en: 'Expires in', ru: 'Истекает через' },
    getLink: { en: 'Get link', ru: 'Получить ссылку' },
    indefinitely: { en: 'Indefinitely', ru: 'Бессрочно' },
    inactive: { en: 'Inactive', ru: 'Неактивна' },
    installationGuideHeader: { en: 'Installation guide', ru: 'Инструкция по установке' },
    linkCopied: { en: 'Link copied', ru: 'Ссылка скопирована' },
    linkCopiedToClipboard: {
        en: 'Subscription link copied to clipboard',
        ru: 'Ссылка подписки скопирована в буфер обмена',
    },
    name: { en: 'Name', ru: 'Название' },
    scanQrCode: { en: 'Scan QR code', ru: 'Сканировать QR-код' },
    scanQrCodeDescription: {
        en: 'Scan this QR code from the app',
        ru: 'Сканируйте этот QR-код из приложения',
    },
    scanToImport: { en: 'Scan to import', ru: 'Сканируйте для импорта' },
    status: { en: 'Status', ru: 'Статус' },
    unknown: { en: 'Unknown', ru: 'Неизвестно' },
};

const FALLBACK_RUNTIME_CONFIG: TSubscriptionPageRawConfig = {
    version: '1',
    locales: ['ru', 'en'],
    brandingSettings: {
        title: 'Subscription',
        logoUrl: 'https://docs.rw/img/logo.svg',
        supportUrl: 'https://t.me/remnawave',
    },
    uiConfig: {
        subscriptionInfoBlockType: 'hidden',
        installationGuidesBlockType: 'minimal',
    },
    baseSettings: {
        metaTitle: 'Subscription',
        metaDescription: 'Subscription',
        showConnectionKeys: false,
        hideGetLinkButton: false,
    },
    baseTranslations: FALLBACK_TRANSLATIONS,
    svgLibrary: {},
    platforms: {},
};

export interface RuntimeConfigHealth {
    ok: true;
    appConfigRoute: string;
    fallbackConfigOk: boolean;
    canSerializeFallback: boolean;
    lastRuntimeConfigError: string | null;
    lastConfigSource: string | null;
    lastMissingSources: string[];
}

@Injectable()
export class RuntimeConfigService {
    private readonly logger = new Logger(RuntimeConfigService.name);
    private lastRuntimeConfigError: string | null = null;
    private lastConfigSource: string | null = null;
    private lastMissingSources: string[] = [];

    constructor(private readonly subpageConfigService: SubpageConfigService) {}

    public getRuntimeConfig(user: IJwtPayload | undefined, request: Request): TSubscriptionPageRawConfig {
        const missingSources = this.getMissingSources(user);
        this.lastMissingSources = missingSources;

        try {
            if (missingSources.length > 0) {
                this.recordRuntimeConfigError(
                    `Missing runtime config source(s): ${missingSources.join(', ')}`,
                    request,
                );
                this.recordConfigSource('fallback', missingSources);
                return FALLBACK_RUNTIME_CONFIG;
            }

            const config = this.subpageConfigService.getSubscriptionPageConfigByEncryptedUuid(user?.su);

            if (!config) {
                this.recordRuntimeConfigError(
                    'Subpage config cannot be resolved from session.su',
                    request,
                );
                this.recordConfigSource('fallback', missingSources);
                return FALLBACK_RUNTIME_CONFIG;
            }

            this.lastRuntimeConfigError = null;
            this.recordConfigSource('remnawave-subpage-config', missingSources);
            return config;
        } catch (error) {
            this.recordRuntimeConfigError(error, request);
            this.recordConfigSource('fallback-after-error', missingSources);
            return FALLBACK_RUNTIME_CONFIG;
        }
    }

    public serializeRuntimeConfig(config: TSubscriptionPageRawConfig): string {
        try {
            return JSON.stringify(config);
        } catch (error) {
            this.lastRuntimeConfigError = this.getErrorMessage(error);
            this.logger.error('[RuntimeConfig] runtime config serialization failed', error);
            return JSON.stringify(FALLBACK_RUNTIME_CONFIG);
        }
    }

    public getHealth(): RuntimeConfigHealth {
        const canSerializeFallback = this.canSerializeFallback();

        return {
            ok: true,
            appConfigRoute: '/assets/.app-config-v2.json',
            fallbackConfigOk: canSerializeFallback,
            canSerializeFallback,
            lastRuntimeConfigError: this.lastRuntimeConfigError,
            lastConfigSource: this.lastConfigSource,
            lastMissingSources: this.lastMissingSources,
        };
    }

    private getMissingSources(user: IJwtPayload | undefined): string[] {
        const missingSources: string[] = [];

        if (!user?.su) {
            missingSources.push('session.su');
        }

        return missingSources;
    }

    private recordConfigSource(source: string, missingSources: string[]): void {
        this.lastConfigSource = source;
        this.logger.log(
            `[RuntimeConfig] ${JSON.stringify({
                source,
                missingSources,
                schemaVersion: FALLBACK_RUNTIME_CONFIG.version,
            })}`,
        );
    }

    private recordRuntimeConfigError(error: unknown, request: Request): void {
        const errorMessage = this.getErrorMessage(error);
        this.lastRuntimeConfigError = errorMessage;
        this.logger.warn(`[RuntimeConfig] ${request.path}: ${errorMessage}`);
    }

    private canSerializeFallback(): boolean {
        try {
            JSON.stringify(FALLBACK_RUNTIME_CONFIG);
            return true;
        } catch (error) {
            this.lastRuntimeConfigError = this.getErrorMessage(error);
            return false;
        }
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
