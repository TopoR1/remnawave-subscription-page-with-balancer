import {
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    Container,
    Group,
    NumberInput,
    PasswordInput,
    ScrollArea,
    Select,
    SimpleGrid,
    Stack,
    Table,
    Tabs,
    Text,
    TextInput,
    Tooltip,
    Title
} from '@mantine/core'
import {
    IconAlertTriangle,
    IconDatabase,
    IconDownload,
    IconInfoCircle,
    IconLogout,
    IconRefresh,
    IconSearch,
    IconShieldLock
} from '@tabler/icons-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { notifications } from '@mantine/notifications'

import { Page } from '@shared/ui'

import classes from './topor-balancer-admin.module.css'

const ADMIN_TOKEN_STORAGE_KEY = 'toporBalancerAdminToken'
const ADMIN_HEALTH_URL = '/api/topor-balancer/health'
const ADMIN_NODES_URL = '/api/topor-balancer/nodes'
const ADMIN_ASSIGNMENTS_URL = '/api/topor-balancer/assignments'
const ADMIN_REQUESTS_URL = '/api/topor-balancer/requests'
const DISCOVERY_API_URL = '/api/topor-balancer/discovery/remnawave'
const DISCOVERY_SUBSCRIPTION_URL = '/api/topor-balancer/discovery/subscription'
const DISCOVERY_IMPORT_URL = '/api/topor-balancer/discovery/import'
const RUNTIME_CONFIG_HEALTH_URL = '/api/topor-balancer/runtime-config-health'

const NODE_STATUSES = ['active', 'draining', 'disabled', 'dead'] as const

type ToporBalancerNodeStatus = (typeof NODE_STATUSES)[number]

interface ToporBalancerHealth {
    assignmentCount: number
    assignmentMode: string
    configLoaded: boolean
    databaseConnected: boolean
    enabled: boolean
    lastError?: string
    nodeCount: number
    remnawavePanelUrl?: string
    requestCount?: number
}

interface RuntimeConfigHealth {
    appConfigRoute: string
    canSerializeFallback: boolean
    fallbackConfigOk: boolean
    lastConfigSource: string | null
    lastMissingSources: string[]
    lastRuntimeConfigError: string | null
    ok: boolean
}

interface ToporBalancerNode {
    assignedUsers: number
    id: string
    locationCode?: string
    maxUsers: number
    planCode: string
    publicHostCode: string
    publicName: string
    status: ToporBalancerNodeStatus
    technicalHostName: string
    updatedAt?: string
    weight: number
}

interface ToporBalancerAssignment {
    createdAt?: string
    id: string
    nodeId: string
    planCode: string
    publicHostCode: string
    shortUuid: string
    technicalHostName?: string
    updatedAt?: string
}

interface ToporBalancerRequest {
    createdAt?: string
    errorMessage?: string
    id: string
    inputLinksCount?: number
    outputLinksCount?: number
    responseFormat?: string
    shortUuid: string
    status?: string
    userAgent?: string
}

interface DiscoveredHost {
    alreadyImported: boolean
    flow?: string
    host?: string
    matchedNodeId: string | null
    pbk?: string
    port?: number
    protocol?: 'vless'
    rawRemark?: string
    remnawaveNodeName?: string
    remnawaveNodeUuid?: string
    security?: string
    sid?: string
    sni?: string
    technicalHostName: string
    type?: string
}

interface DiscoveryResponse {
    items: DiscoveredHost[]
    shortUuid?: string
    source: 'remnawave-api' | 'subscription'
}

interface ImportResult {
    created: ToporBalancerNode[]
    skipped: Array<{ reason: string; technicalHostName: string }>
    updated: ToporBalancerNode[]
}

const statusLabels: Record<ToporBalancerNodeStatus, string> = {
    active: 'Активна',
    dead: 'Авария',
    disabled: 'Отключена',
    draining: 'Выводится'
}

const statusTooltips: Record<ToporBalancerNodeStatus, string> = {
    active: 'Нода используется для новых и текущих пользователей.',
    dead: 'Аварийный статус. Пользователи будут переназначаться при возможности.',
    disabled: 'Нода не используется.',
    draining: 'Новые пользователи не назначаются, старые остаются.'
}

const tooltips = {
    maxUsers: 'Мягкий лимит назначенных пользователей для расчёта загрузки.',
    planCode: 'Код тарифа, например standard или game.',
    publicHostCode: 'Внутренний код группы балансировки.',
    publicName: 'Название, которое увидит пользователь в приложении.',
    technicalHostName: 'Должно точно совпадать с названием VLESS-ссылки после #.',
    weight: 'Относительная доля нагрузки. Чем больше число, тем больше пользователей можно назначать на ноду.'
}

function Help({ label }: { label: string }) {
    return (
        <Tooltip label={label} maw={360} multiline withArrow>
            <IconInfoCircle size={16} />
        </Tooltip>
    )
}

function HeaderWithHelp({ children, help }: { children: string; help: string }) {
    return (
        <Group gap={4} wrap="nowrap">
            {children}
            <Help label={help} />
        </Group>
    )
}

function getStatusColor(status: ToporBalancerNodeStatus) {
    const colors: Record<ToporBalancerNodeStatus, string> = {
        active: 'green',
        dead: 'red',
        disabled: 'gray',
        draining: 'yellow'
    }

    return colors[status]
}

function formatDate(value?: string) {
    if (!value) {
        return '-'
    }

    const date = new Date(value)

    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU')
}

function redactSensitiveText(value?: string) {
    if (!value) {
        return '-'
    }

    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [скрыто]')
        .replace(/(token|key|secret|password)=([^&\s]+)/gi, '$1=[скрыто]')
        .replace(/vless:\/\/[^\s]+/gi, '[ссылка скрыта]')
        .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, '[uuid скрыт]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip скрыт]')
}

function maskShort(value: string) {
    if (value.length <= 8) {
        return `${value.slice(0, 2)}***`
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function statusOptions() {
    return NODE_STATUSES.map((status) => ({
        label: statusLabels[status],
        value: status
    }))
}

function safeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : []
}

export function ToporBalancerAdminPage() {
    const [tokenInput, setTokenInput] = useState('')
    const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY))
    const [health, setHealth] = useState<null | ToporBalancerHealth>(null)
    const [runtimeHealth, setRuntimeHealth] = useState<null | RuntimeConfigHealth>(null)
    const [nodes, setNodes] = useState<ToporBalancerNode[]>([])
    const [assignments, setAssignments] = useState<ToporBalancerAssignment[]>([])
    const [requests, setRequests] = useState<ToporBalancerRequest[]>([])
    const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([])
    const [selectedHosts, setSelectedHosts] = useState<string[]>([])
    const [errorMessage, setErrorMessage] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false)
    const [shortUuid, setShortUuid] = useState('')
    const [wizardStep, setWizardStep] = useState(1)
    const [groupForm, setGroupForm] = useState({
        locationCode: 'FI',
        maxUsers: 300,
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: '🇫🇮 Finland',
        status: 'active' as ToporBalancerNodeStatus,
        weight: 1
    })

    const isLoggedIn = Boolean(adminToken)
    const importedByTechnicalHostName = useMemo(
        () => new Map(nodes.map((node) => [node.technicalHostName, node])),
        [nodes]
    )

    const fetchAdminJson = useCallback(
        async <ResponseBody,>(url: string, options?: RequestInit): Promise<ResponseBody | null> => {
            if (!adminToken) {
                return null
            }

            const response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                    ...options?.headers
                }
            })

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
                setAdminToken(null)
                setErrorMessage('Неверный токен администратора')
                return null
            }

            if (!response.ok) {
                throw new Error(`Admin API вернул статус ${response.status}`)
            }

            return (await response.json()) as ResponseBody
        },
        [adminToken]
    )

    const refreshAdminData = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsLoading(true)
        setErrorMessage('')

        try {
            const [healthResponse, runtimeResponse, nodesResponse, assignmentsResponse, requestsResponse] =
                await Promise.all([
                    fetchAdminJson<ToporBalancerHealth>(ADMIN_HEALTH_URL),
                    fetchAdminJson<RuntimeConfigHealth>(RUNTIME_CONFIG_HEALTH_URL),
                    fetchAdminJson<ToporBalancerNode[]>(ADMIN_NODES_URL),
                    fetchAdminJson<ToporBalancerAssignment[]>(ADMIN_ASSIGNMENTS_URL),
                    fetchAdminJson<ToporBalancerRequest[]>(ADMIN_REQUESTS_URL)
                ])

            if (healthResponse) {
                setHealth(healthResponse)
            }

            if (runtimeResponse) {
                setRuntimeHealth(runtimeResponse)
            }

            if (nodesResponse) {
                setNodes(safeArray<ToporBalancerNode>(nodesResponse))
            }

            if (assignmentsResponse) {
                setAssignments(safeArray<ToporBalancerAssignment>(assignmentsResponse).slice(0, 500))
            }

            if (requestsResponse) {
                setRequests(safeArray<ToporBalancerRequest>(requestsResponse).slice(0, 500))
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Не удалось загрузить Admin API')
        } finally {
            setIsLoading(false)
        }
    }, [adminToken, fetchAdminJson])

    useEffect(() => {
        if (adminToken) {
            refreshAdminData()
        }
    }, [adminToken, refreshAdminData])

    const saveToken = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const trimmedToken = tokenInput.trim()

        if (!trimmedToken) {
            return
        }

        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmedToken)
        setAdminToken(trimmedToken)
        setTokenInput('')
        setErrorMessage('')
    }

    const logout = () => {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
        setAdminToken(null)
        setHealth(null)
        setRuntimeHealth(null)
        setNodes([])
        setAssignments([])
        setRequests([])
        setDiscoveredHosts([])
        setSelectedHosts([])
    }

    const runApiDiscovery = async () => {
        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
            const response = await fetchAdminJson<DiscoveryResponse>(DISCOVERY_API_URL)
            const items = response?.items ?? []
            setDiscoveredHosts(items)
            setSelectedHosts(items.filter((item) => !item.alreadyImported).map((item) => item.technicalHostName))
            setWizardStep(3)
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Не удалось получить ноды из Remnawave API')
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const runSubscriptionDiscovery = async () => {
        const normalizedShortUuid = shortUuid.trim()

        if (!normalizedShortUuid) {
            notifications.show({
                color: 'red',
                message: 'Введите shortUuid тестовой подписки',
                title: 'Не хватает данных'
            })
            return
        }

        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
            const response = await fetchAdminJson<DiscoveryResponse>(DISCOVERY_SUBSCRIPTION_URL, {
                body: JSON.stringify({ shortUuid: normalizedShortUuid }),
                method: 'POST'
            })
            const items = response?.items ?? []
            setDiscoveredHosts(items)
            setSelectedHosts(items.filter((item) => !item.alreadyImported).map((item) => item.technicalHostName))
            setWizardStep(3)
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Не удалось просканировать подписку')
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const toggleSelectedHost = (technicalHostName: string) => {
        setSelectedHosts((current) =>
            current.includes(technicalHostName)
                ? current.filter((item) => item !== technicalHostName)
                : [...current, technicalHostName]
        )
    }

    const importSelectedHosts = async () => {
        const selected = discoveredHosts.filter((host) => selectedHosts.includes(host.technicalHostName))

        if (selected.length === 0) {
            notifications.show({
                color: 'red',
                message: 'Выберите хотя бы одну техническую ноду',
                title: 'Импорт не запущен'
            })
            return
        }

        if (!groupForm.publicHostCode.trim() || !groupForm.publicName.trim() || !groupForm.planCode.trim()) {
            notifications.show({
                color: 'red',
                message: 'Заполните publicName, publicHostCode и planCode',
                title: 'Не хватает данных'
            })
            return
        }

        setIsDiscoveryLoading(true)

        try {
            const result = await fetchAdminJson<ImportResult>(DISCOVERY_IMPORT_URL, {
                body: JSON.stringify({
                    locationCode: groupForm.locationCode.trim() || undefined,
                    nodes: selected.map((host) => ({
                        maxUsers: groupForm.maxUsers,
                        status: groupForm.status,
                        technicalHostName: host.technicalHostName,
                        weight: groupForm.weight
                    })),
                    planCode: groupForm.planCode.trim(),
                    publicHostCode: groupForm.publicHostCode.trim(),
                    publicName: groupForm.publicName.trim()
                }),
                method: 'POST'
            })

            await refreshAdminData()
            setWizardStep(5)
            notifications.show({
                color: 'green',
                message: `Создано: ${result?.created.length ?? 0}, обновлено: ${result?.updated.length ?? 0}`,
                title: 'Импорт завершён'
            })
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Не удалось импортировать ноды')
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const setNodeStatus = async (node: ToporBalancerNode, action: 'disable' | 'drain' | 'enable') => {
        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerNode>(`${ADMIN_NODES_URL}/${node.id}/${action}`, {
                method: 'POST'
            })
            await refreshAdminData()
            notifications.show({
                color: 'green',
                message: `${node.technicalHostName}: статус обновлён`,
                title: 'Готово'
            })
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Не удалось обновить статус ноды')
        } finally {
            setIsLoading(false)
        }
    }

    const createManualNode = async () => {
        if (!groupForm.publicHostCode.trim() || !groupForm.publicName.trim() || !groupForm.planCode.trim()) {
            notifications.show({
                color: 'red',
                message: 'Для ручного добавления используйте discovery/import или заполните группу через wizard',
                title: 'Не хватает данных'
            })
        }
    }

    const statusCards = [
        { color: health?.enabled ? 'green' : 'gray', label: 'Balancer', value: health?.enabled ? 'Включён' : 'Отключён' },
        { color: health?.databaseConnected ? 'green' : 'red', label: 'База данных', value: health?.databaseConnected ? 'Подключена' : 'Нет связи' },
        { color: 'cyan', label: 'Режим', value: health?.assignmentMode ?? '-' },
        { color: 'blue', label: 'Нод в Balancer', value: String(nodes.length) },
        { color: runtimeHealth?.fallbackConfigOk ? 'green' : 'red', label: 'Runtime config', value: runtimeHealth?.fallbackConfigOk ? 'OK' : 'Проблема' },
        { color: 'violet', label: 'Запросов', value: String(health?.requestCount ?? requests.length) }
    ]

    return (
        <Page>
            <Container maw={1400} px={{ base: 'md', sm: 'lg', md: 'xl' }} py="xl">
                <Stack gap="lg">
                    <Group justify="space-between">
                        <Group gap="sm">
                            <IconDatabase className={classes.titleIcon} size={28} />
                            <div>
                                <Title order={2}>Remnawave Balancer by TopoR</Title>
                                <Text c="dimmed" size="sm">
                                    Панель настройки и диагностики балансировщика
                                </Text>
                            </div>
                        </Group>

                        {isLoggedIn && (
                            <Group gap="sm">
                                <Button leftSection={<IconRefresh size={16} />} loading={isLoading} onClick={refreshAdminData} variant="light">
                                    Обновить
                                </Button>
                                <Button color="red" leftSection={<IconLogout size={16} />} onClick={logout} variant="subtle">
                                    Выйти
                                </Button>
                            </Group>
                        )}
                    </Group>

                    {errorMessage && (
                        <Alert color="red" icon={<IconAlertTriangle size={18} />} variant="light">
                            {errorMessage}
                        </Alert>
                    )}

                    {!isLoggedIn && (
                        <Card className={classes.loginCard} p="lg" radius="md">
                            <form onSubmit={saveToken}>
                                <Stack gap="md">
                                    <Group gap="sm">
                                        <IconShieldLock size={22} />
                                        <Title order={4}>Токен администратора</Title>
                                    </Group>
                                    <PasswordInput
                                        autoComplete="current-password"
                                        label="Токен"
                                        onChange={(event) => setTokenInput(event.currentTarget.value)}
                                        placeholder="Вставьте TOPOR_BALANCER_ADMIN_TOKEN"
                                        value={tokenInput}
                                    />
                                    <Button loading={isLoading} type="submit">
                                        Войти
                                    </Button>
                                </Stack>
                            </form>
                        </Card>
                    )}

                    {isLoggedIn && (
                        <>
                            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
                                {statusCards.map((card) => (
                                    <Card className={classes.statusCard} key={card.label} p="lg" radius="md">
                                        <Stack gap={6}>
                                            <Text c="dimmed" size="sm">
                                                {card.label}
                                            </Text>
                                            <Text c={card.color} className={classes.statusValue} fw={700}>
                                                {card.value}
                                            </Text>
                                        </Stack>
                                    </Card>
                                ))}
                            </SimpleGrid>

                            {nodes.length === 0 && (
                                <Card className={classes.tableCard} p="lg" radius="md">
                                    <Stack gap="md">
                                        <Group justify="space-between">
                                            <div>
                                                <Title order={3}>Первичная настройка</Title>
                                                <Text c="dimmed" size="sm">
                                                    Найдите технические ноды Remnawave и импортируйте их в Balancer.
                                                </Text>
                                            </div>
                                            <Badge color="yellow" variant="light">
                                                Шаг {wizardStep} из 5
                                            </Badge>
                                        </Group>

                                        {wizardStep === 1 && (
                                            <Stack gap="md">
                                                <Title order={4}>Проверка подключения к Remnawave</Title>
                                                <Text>Панель: {health?.remnawavePanelUrl || '-'}</Text>
                                                <Badge color={health ? 'green' : 'red'} w="fit-content">
                                                    {health ? 'Подключено' : 'Нет данных'}
                                                </Badge>
                                                <Button onClick={() => setWizardStep(2)}>Продолжить</Button>
                                            </Stack>
                                        )}

                                        {wizardStep === 2 && (
                                            <Stack gap="md">
                                                <Title order={4}>Найти технические ноды</Title>
                                                <Group align="end">
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runApiDiscovery}>
                                                        Получить из Remnawave API
                                                    </Button>
                                                    <TextInput
                                                        label="shortUuid тестовой подписки"
                                                        onChange={(event) => setShortUuid(event.currentTarget.value)}
                                                        placeholder="shortUuid"
                                                        value={shortUuid}
                                                    />
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runSubscriptionDiscovery} variant="light">
                                                        Сканировать подписку
                                                    </Button>
                                                </Group>
                                            </Stack>
                                        )}

                                        {wizardStep === 3 && (
                                            <Stack gap="md">
                                                <Title order={4}>Сгруппировать ноды</Title>
                                                <DiscoveredHostsTable
                                                    hosts={discoveredHosts}
                                                    importedByTechnicalHostName={importedByTechnicalHostName}
                                                    selectedHosts={selectedHosts}
                                                    toggleSelectedHost={toggleSelectedHost}
                                                />
                                                <Group grow>
                                                    <TextInput
                                                        description={tooltips.publicName}
                                                        label="publicName"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                                                        value={groupForm.publicName}
                                                    />
                                                    <TextInput
                                                        description={tooltips.publicHostCode}
                                                        label="publicHostCode"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                                                        value={groupForm.publicHostCode}
                                                    />
                                                    <TextInput
                                                        label="locationCode"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                                                        value={groupForm.locationCode}
                                                    />
                                                    <TextInput
                                                        description={tooltips.planCode}
                                                        label="planCode"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                                        value={groupForm.planCode}
                                                    />
                                                </Group>
                                                <Button onClick={() => setWizardStep(4)}>Продолжить к импорту</Button>
                                            </Stack>
                                        )}

                                        {wizardStep === 4 && (
                                            <Stack gap="md">
                                                <Title order={4}>Импортировать</Title>
                                                <Text>
                                                    Будет импортировано: {selectedHosts.length}. Уже импортированные ноды будут обновлены без создания дублей.
                                                </Text>
                                                <Group>
                                                    <NumberInput
                                                        description={tooltips.weight}
                                                        label="weight"
                                                        min={0.0001}
                                                        onChange={(value) => setGroupForm((current) => ({ ...current, weight: Number(value) || 1 }))}
                                                        value={groupForm.weight}
                                                    />
                                                    <NumberInput
                                                        description={tooltips.maxUsers}
                                                        label="maxUsers"
                                                        min={1}
                                                        onChange={(value) => setGroupForm((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                                                        value={groupForm.maxUsers}
                                                    />
                                                    <Select
                                                        data={statusOptions()}
                                                        description={statusTooltips[groupForm.status]}
                                                        label="status"
                                                        onChange={(value) =>
                                                            setGroupForm((current) => ({
                                                                ...current,
                                                                status: (value as ToporBalancerNodeStatus | null) || 'active'
                                                            }))
                                                        }
                                                        value={groupForm.status}
                                                    />
                                                </Group>
                                                <Button leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={importSelectedHosts}>
                                                    Импортировать
                                                </Button>
                                            </Stack>
                                        )}

                                        {wizardStep === 5 && (
                                            <Stack gap="md">
                                                <Title order={4}>Проверить</Title>
                                                <Text>Импортированные ноды появились в категории “Управляется Balancer”. Следующий шаг: открыть реальную ссылку подписки.</Text>
                                                <Button onClick={refreshAdminData}>Обновить состояние</Button>
                                            </Stack>
                                        )}
                                    </Stack>
                                </Card>
                            )}

                            <Tabs defaultValue="discovery">
                                <Tabs.List>
                                    <Tabs.Tab value="discovery">Найдено в Remnawave</Tabs.Tab>
                                    <Tabs.Tab value="nodes">Управляется Balancer</Tabs.Tab>
                                    <Tabs.Tab value="diagnostics">Диагностика</Tabs.Tab>
                                </Tabs.List>

                                <Tabs.Panel pt="md" value="discovery">
                                    <Stack gap="md">
                                        <Group align="end">
                                            <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runApiDiscovery}>
                                                Получить из Remnawave API
                                            </Button>
                                            <TextInput
                                                label="shortUuid тестовой подписки"
                                                onChange={(event) => setShortUuid(event.currentTarget.value)}
                                                placeholder="shortUuid"
                                                value={shortUuid}
                                            />
                                            <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runSubscriptionDiscovery} variant="light">
                                                Сканировать подписку
                                            </Button>
                                        </Group>

                                        <DiscoveredHostsTable
                                            hosts={discoveredHosts}
                                            importedByTechnicalHostName={importedByTechnicalHostName}
                                            selectedHosts={selectedHosts}
                                            toggleSelectedHost={toggleSelectedHost}
                                        />

                                        <Card className={classes.tableCard} p="md" radius="md">
                                            <Stack gap="md">
                                                <Title order={4}>Группа балансировки</Title>
                                                <Group grow>
                                                    <TextInput
                                                        description={tooltips.publicName}
                                                        label="publicName"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                                                        value={groupForm.publicName}
                                                    />
                                                    <TextInput
                                                        description={tooltips.publicHostCode}
                                                        label="publicHostCode"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                                                        value={groupForm.publicHostCode}
                                                    />
                                                    <TextInput
                                                        label="locationCode"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                                                        value={groupForm.locationCode}
                                                    />
                                                    <TextInput
                                                        description={tooltips.planCode}
                                                        label="planCode"
                                                        onChange={(event) => setGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                                        value={groupForm.planCode}
                                                    />
                                                </Group>
                                                <Group>
                                                    <NumberInput
                                                        description={tooltips.weight}
                                                        label="weight"
                                                        min={0.0001}
                                                        onChange={(value) => setGroupForm((current) => ({ ...current, weight: Number(value) || 1 }))}
                                                        value={groupForm.weight}
                                                    />
                                                    <NumberInput
                                                        description={tooltips.maxUsers}
                                                        label="maxUsers"
                                                        min={1}
                                                        onChange={(value) => setGroupForm((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                                                        value={groupForm.maxUsers}
                                                    />
                                                    <Select
                                                        data={statusOptions()}
                                                        description={statusTooltips[groupForm.status]}
                                                        label="status"
                                                        onChange={(value) =>
                                                            setGroupForm((current) => ({
                                                                ...current,
                                                                status: (value as ToporBalancerNodeStatus | null) || 'active'
                                                            }))
                                                        }
                                                        value={groupForm.status}
                                                    />
                                                </Group>
                                                <Button leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={importSelectedHosts}>
                                                    Импортировать выбранные
                                                </Button>
                                            </Stack>
                                        </Card>
                                    </Stack>
                                </Tabs.Panel>

                                <Tabs.Panel pt="md" value="nodes">
                                    <Stack gap="md">
                                        <Group justify="space-between">
                                            <div>
                                                <Title order={3}>Управляется Balancer</Title>
                                                <Text c="dimmed" size="sm">
                                                    {nodes.length} локальных нод участвуют в балансировке.
                                                </Text>
                                            </div>
                                            <Button onClick={createManualNode} variant="light">
                                                Ручное добавление
                                            </Button>
                                        </Group>
                                        <ManagedNodesTable nodes={nodes} setNodeStatus={setNodeStatus} />
                                    </Stack>
                                </Tabs.Panel>

                                <Tabs.Panel pt="md" value="diagnostics">
                                    <Stack gap="md">
                                        <Alert color={runtimeHealth?.fallbackConfigOk ? 'green' : 'red'} variant="light">
                                            Runtime config: {runtimeHealth?.appConfigRoute ?? '/assets/.app-config-v2.json'}; source:{' '}
                                            {runtimeHealth?.lastConfigSource ?? '-'}; error:{' '}
                                            {runtimeHealth?.lastRuntimeConfigError ?? '-'}
                                        </Alert>
                                        <AssignmentsTable assignments={assignments} nodes={nodes} />
                                        <RequestsTable requests={requests} />
                                    </Stack>
                                </Tabs.Panel>
                            </Tabs>
                        </>
                    )}
                </Stack>
            </Container>
        </Page>
    )
}

function DiscoveredHostsTable({
    hosts,
    importedByTechnicalHostName,
    selectedHosts,
    toggleSelectedHost
}: {
    hosts: DiscoveredHost[]
    importedByTechnicalHostName: Map<string, ToporBalancerNode>
    selectedHosts: string[]
    toggleSelectedHost: (technicalHostName: string) => void
}) {
    if (hosts.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>Ноды ещё не найдены</Text>
                    <Text c="dimmed" size="sm">
                        Запустите поиск через Remnawave API или тестовую подписку.
                    </Text>
                </Stack>
            </Card>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.discoveryTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th />
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.technicalHostName}>technicalHostName</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>Статус</Table.Th>
                            <Table.Th>host</Table.Th>
                            <Table.Th>port</Table.Th>
                            <Table.Th>security</Table.Th>
                            <Table.Th>type</Table.Th>
                            <Table.Th>sni</Table.Th>
                            <Table.Th>flow</Table.Th>
                            <Table.Th>pbk/sid</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {hosts.map((host) => {
                            const importedNode = importedByTechnicalHostName.get(host.technicalHostName)
                            const isImported = host.alreadyImported || Boolean(importedNode)

                            return (
                                <Table.Tr key={host.technicalHostName}>
                                    <Table.Td>
                                        <Checkbox
                                            checked={selectedHosts.includes(host.technicalHostName)}
                                            onChange={() => toggleSelectedHost(host.technicalHostName)}
                                        />
                                    </Table.Td>
                                    <Table.Td>{host.technicalHostName}</Table.Td>
                                    <Table.Td>
                                        <Badge color={isImported ? 'green' : 'yellow'} variant="light">
                                            {isImported ? 'Импортировано' : 'Не импортировано'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>{redactSensitiveText(host.host)}</Table.Td>
                                    <Table.Td>{host.port ?? '-'}</Table.Td>
                                    <Table.Td>{host.security ?? '-'}</Table.Td>
                                    <Table.Td>{host.type ?? '-'}</Table.Td>
                                    <Table.Td>{redactSensitiveText(host.sni)}</Table.Td>
                                    <Table.Td>{host.flow ?? '-'}</Table.Td>
                                    <Table.Td>{[host.pbk, host.sid].filter(Boolean).join(' / ') || '-'}</Table.Td>
                                </Table.Tr>
                            )
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function ManagedNodesTable({
    nodes,
    setNodeStatus
}: {
    nodes: ToporBalancerNode[]
    setNodeStatus: (node: ToporBalancerNode, action: 'disable' | 'drain' | 'enable') => void
}) {
    if (nodes.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>В Balancer пока нет нод</Text>
                    <Text c="dimmed" size="sm">
                        Используйте wizard или вкладку “Найдено в Remnawave”.
                    </Text>
                </Stack>
            </Card>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.nodesTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.publicHostCode}>publicHostCode</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.publicName}>publicName</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.technicalHostName}>technicalHostName</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.planCode}>planCode</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>locationCode</Table.Th>
                            <Table.Th>status</Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.weight}>weight</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.maxUsers}>maxUsers</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>assignedUsers</Table.Th>
                            <Table.Th>Действия</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {nodes.map((node) => (
                            <Table.Tr className={classes[`row-${node.status}`]} key={node.id}>
                                <Table.Td>{node.publicHostCode}</Table.Td>
                                <Table.Td>{node.publicName}</Table.Td>
                                <Table.Td>{node.technicalHostName}</Table.Td>
                                <Table.Td>{node.planCode}</Table.Td>
                                <Table.Td>{node.locationCode || '-'}</Table.Td>
                                <Table.Td>
                                    <Tooltip label={statusTooltips[node.status]} withArrow>
                                        <Badge color={getStatusColor(node.status)} variant="light">
                                            {statusLabels[node.status]}
                                        </Badge>
                                    </Tooltip>
                                </Table.Td>
                                <Table.Td>{node.weight}</Table.Td>
                                <Table.Td>{node.maxUsers}</Table.Td>
                                <Table.Td>{node.assignedUsers}</Table.Td>
                                <Table.Td>
                                    <Group gap={6} wrap="nowrap">
                                        <Button disabled={node.status === 'active'} onClick={() => setNodeStatus(node, 'enable')} size="xs" variant="light">
                                            Включить
                                        </Button>
                                        <Button disabled={node.status === 'draining'} onClick={() => setNodeStatus(node, 'drain')} size="xs" variant="light">
                                            Выводить
                                        </Button>
                                        <Button color="red" disabled={node.status === 'disabled'} onClick={() => setNodeStatus(node, 'disable')} size="xs" variant="subtle">
                                            Отключить
                                        </Button>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function AssignmentsTable({ assignments, nodes }: { assignments: ToporBalancerAssignment[]; nodes: ToporBalancerNode[] }) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.assignmentsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>shortUuid</Table.Th>
                            <Table.Th>publicHostCode</Table.Th>
                            <Table.Th>planCode</Table.Th>
                            <Table.Th>technicalHostName</Table.Th>
                            <Table.Th>updatedAt</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {assignments.map((assignment) => (
                            <Table.Tr key={assignment.id}>
                                <Table.Td>{maskShort(assignment.shortUuid)}</Table.Td>
                                <Table.Td>{assignment.publicHostCode}</Table.Td>
                                <Table.Td>{assignment.planCode}</Table.Td>
                                <Table.Td>{assignment.technicalHostName || nodeById.get(assignment.nodeId)?.technicalHostName || '-'}</Table.Td>
                                <Table.Td>{formatDate(assignment.updatedAt)}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function RequestsTable({ requests }: { requests: ToporBalancerRequest[] }) {
    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.requestsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>createdAt</Table.Th>
                            <Table.Th>shortUuid</Table.Th>
                            <Table.Th>responseFormat</Table.Th>
                            <Table.Th>inputLinksCount</Table.Th>
                            <Table.Th>outputLinksCount</Table.Th>
                            <Table.Th>status</Table.Th>
                            <Table.Th>errorMessage</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {requests.map((request) => (
                            <Table.Tr key={request.id}>
                                <Table.Td>{formatDate(request.createdAt)}</Table.Td>
                                <Table.Td>{maskShort(request.shortUuid)}</Table.Td>
                                <Table.Td>{request.responseFormat || '-'}</Table.Td>
                                <Table.Td>{request.inputLinksCount ?? '-'}</Table.Td>
                                <Table.Td>{request.outputLinksCount ?? '-'}</Table.Td>
                                <Table.Td>{request.status || '-'}</Table.Td>
                                <Table.Td className={classes.wrapCell}>{redactSensitiveText(request.errorMessage)}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}
