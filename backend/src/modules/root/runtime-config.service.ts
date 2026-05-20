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

@Injectable()
export class RuntimeConfigService {
    private readonly logger = new Logger(RuntimeConfigService.name);

    constructor(private readonly subpageConfigService: SubpageConfigService) {}

    public getRuntimeConfig(user: IJwtPayload | undefined, request: Request): TSubscriptionPageRawConfig {
        const missingSources = this.getMissingSources(user);

        try {
            const config = this.subpageConfigService.getSubscriptionPageConfigByEncryptedUuid(user?.su);

            if (!config) {
                this.logDiagnostics('fallback', FALLBACK_RUNTIME_CONFIG, missingSources);
                return FALLBACK_RUNTIME_CONFIG;
            }

            this.logDiagnostics('remnawave-subpage-config', config, missingSources);
            return config;
        } catch (error) {
            this.logger.error(
                `[ToporBalancerConfig] runtime config generation failed for ${request.path}`,
                error,
            );
            this.logDiagnostics('fallback-after-error', FALLBACK_RUNTIME_CONFIG, missingSources);
            return FALLBACK_RUNTIME_CONFIG;
        }
    }

    public serializeRuntimeConfig(config: TSubscriptionPageRawConfig): string {
        try {
            return JSON.stringify(config);
        } catch (error) {
            this.logger.error('[ToporBalancerConfig] runtime config serialization failed', error);
            return JSON.stringify(FALLBACK_RUNTIME_CONFIG);
        }
    }

    private getMissingSources(user: IJwtPayload | undefined): string[] {
        const missingSources: string[] = [];

        if (!user?.su) {
            missingSources.push('session.su');
        }

        return missingSources;
    }

    private logDiagnostics(
        source: string,
        config: TSubscriptionPageRawConfig,
        missingSources: string[],
    ): void {
        this.logger.log(
            `[ToporBalancerConfig] ${JSON.stringify({
                source,
                missingSources,
                schemaVersion: config.version,
                locales: config.locales,
            })}`,
        );
    }
}
