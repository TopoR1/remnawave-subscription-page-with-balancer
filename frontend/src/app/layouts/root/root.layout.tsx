import {
    APP_CONFIG_ROUTE_LEADING_PATH,
    SubscriptionPageRawConfigSchema
} from '@remnawave/subscription-page-types'
import { GetSubscriptionInfoByShortUuidCommand } from '@remnawave/backend-contract'
import { Outlet, useLocation } from 'react-router-dom'
import { useCallback, useLayoutEffect, useState } from 'react'
import { Alert, Button, Stack, Text } from '@mantine/core'
import consola from 'consola/browser'
import { ofetch } from 'ofetch'

import {
    useSubscriptionInfoStoreActions,
    useSubscriptionInfoStoreInfo
} from '@entities/subscription-info-store'
import { useAppConfigStoreActions, useIsConfigLoaded } from '@entities/app-config-store'
import { LoadingScreen } from '@shared/ui'

import classes from './root.module.css'

export function RootLayout() {
    const location = useLocation()
    const subscriptionActions = useSubscriptionInfoStoreActions()
    const configActions = useAppConfigStoreActions()
    const [configError, setConfigError] = useState('')
    const [configRetryKey, setConfigRetryKey] = useState(0)

    const { subscription } = useSubscriptionInfoStoreInfo()
    const isConfigLoaded = useIsConfigLoaded()
    const isToporBalancerAdminRoute = location.pathname === '/admin/topor-balancer'

    const fetchConfig = useCallback(async () => {
            try {
                setConfigError('')
                const tempConfig = await ofetch<unknown>(
                    `${APP_CONFIG_ROUTE_LEADING_PATH}?v=${Date.now()}`,
                    {
                        parseResponse: (response) => JSON.parse(response)
                    }
                )

                const parsedConfig =
                    await SubscriptionPageRawConfigSchema.safeParseAsync(tempConfig)

                if (!parsedConfig.success) {
                    consola.error('Failed to parse app config:', parsedConfig.error)
                    setConfigError('Не удалось загрузить конфигурацию панели')
                    return
                }

                configActions.setConfig(parsedConfig.data)
            } catch (error) {
                consola.error('Failed to fetch app config:', error)
                setConfigError('Не удалось загрузить конфигурацию панели')
            }
        }, [configActions])

    useLayoutEffect(() => {
        if (isToporBalancerAdminRoute) {
            return
        }

        const subPageDiv = document.getElementById('sbpg')

        if (subPageDiv) {
            const subscriptionUrl = subPageDiv.dataset.panel

            if (subscriptionUrl) {
                try {
                    const subscription: GetSubscriptionInfoByShortUuidCommand.Response = JSON.parse(
                        atob(subscriptionUrl)
                    )

                    subscriptionActions.setSubscriptionInfo({
                        subscription: subscription.response
                    })
                } catch (error) {
                    consola.log(error)
                } finally {
                    subPageDiv.remove()
                }
            }
        }

        fetchConfig()
    }, [configRetryKey, fetchConfig, isToporBalancerAdminRoute])

    if (!isToporBalancerAdminRoute && configError) {
        return (
            <div className={classes.root}>
                <div className="animated-background"></div>
                <div className={classes.content}>
                    <main className={classes.main}>
                        <Stack align="center" gap="md" p="xl">
                            <Alert color="red" title="Ошибка загрузки">
                                <Text>{configError}</Text>
                            </Alert>
                            <Button onClick={() => setConfigRetryKey((value) => value + 1)}>
                                Повторить
                            </Button>
                        </Stack>
                    </main>
                </div>
            </div>
        )
    }

    if (!isToporBalancerAdminRoute && (!isConfigLoaded || !subscription)) {
        return (
            <div className={classes.root}>
                <div className="animated-background"></div>
                <div className={classes.content}>
                    <main className={classes.main}>
                        <LoadingScreen height="100vh" />
                    </main>
                </div>
            </div>
        )
    }

    return (
        <div className={classes.root}>
            <div className="animated-background"></div>
            <div className={classes.content}>
                <main className={classes.main}>
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
