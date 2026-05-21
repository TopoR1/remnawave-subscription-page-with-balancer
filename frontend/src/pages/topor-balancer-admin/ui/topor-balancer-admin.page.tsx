import {
    Alert,
    ActionIcon,
    Badge,
    Button,
    Card,
    Checkbox,
    Container,
    Group,
    Modal,
    NumberInput,
    PasswordInput,
    ScrollArea,
    Select,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    Tabs,
    Text,
    TextInput,
    Tooltip,
    Title
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
    IconAlertTriangle,
    IconDatabase,
    IconDownload,
    IconLogout,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconShieldLock,
    IconTrash
} from '@tabler/icons-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { Page } from '@shared/ui'
import { defaultLocale, i18n } from '../../../i18n'

import classes from './topor-balancer-admin.module.css'

const ADMIN_TOKEN_STORAGE_KEY = 'toporBalancerAdminToken'
const ADMIN_HEALTH_URL = '/api/topor-balancer/health'
const ADMIN_GROUPS_URL = '/api/topor-balancer/groups'
const ADMIN_NODES_URL = '/api/topor-balancer/nodes'
const ADMIN_ASSIGNMENTS_URL = '/api/topor-balancer/assignments'
const ADMIN_REQUESTS_URL = '/api/topor-balancer/requests'
const DISCOVERY_API_URL = '/api/topor-balancer/discovery/remnawave'
const DISCOVERY_SUBSCRIPTION_URL = '/api/topor-balancer/discovery/subscription'
const DISCOVERY_IMPORT_URL = '/api/topor-balancer/discovery/import'
const SUBSCRIPTION_DIAGNOSTICS_URL = '/api/topor-balancer/diagnostics/subscription'
const RUNTIME_CONFIG_HEALTH_URL = '/api/topor-balancer/runtime-config-health'

const NODE_STATUSES = ['active', 'draining', 'disabled', 'dead'] as const
const texts = i18n[defaultLocale].toporBalancerAdmin
const DIAGNOSTICS_USER_AGENTS = [
    { label: 'v2rayNG', value: 'v2rayNG/1.9.0' },
    { label: 'v2RayTun', value: 'v2RayTun/6.0' },
    { label: 'Hiddify', value: 'Hiddify/2.0' },
    { label: 'Happ', value: 'Happ/1.0' },
    { label: texts.diagnostics.customUserAgent, value: 'custom' }
] as const

type ToporBalancerNodeStatus = (typeof NODE_STATUSES)[number]
type ToporBalancerGroupStrategy = 'least_loaded'

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
    fallbackConfigOk: boolean
    lastConfigSource: string | null
    lastRuntimeConfigError: string | null
}

interface ToporBalancerGroup {
    activeNodesCount: number
    assignedUsers: number
    enabled: boolean
    id: string
    locationCode?: string
    nodesCount: number
    planCode: string
    publicHostCode: string
    publicName: string
    strategy: ToporBalancerGroupStrategy
    updatedAt?: string
}

interface ToporBalancerNode {
    assignedUsers: number
    groupId?: string
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
}

interface DiscoveredHost {
    alreadyImported: boolean
    flow?: string
    host?: string
    matchedGroupId?: string
    matchedGroupPlanCode?: string
    matchedGroupPublicHostCode?: string
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
    conflicts: Array<{
        existingGroupId?: string
        existingPlanCode?: string
        existingPublicHostCode?: string
        existingPublicName?: string
        reason: string
        technicalHostName: string
    }>
    created: ToporBalancerNode[]
    errors?: Array<{ reason: string; technicalHostName?: string }>
    skipped: Array<{ reason: string; technicalHostName: string }>
    updated: ToporBalancerNode[]
}

type ImportMode = 'existing' | 'new'
type DiscoveryImportStatus = 'conflict' | 'error' | 'imported' | 'skipped'

interface DiscoveryImportStatusState {
    message?: string
    status: DiscoveryImportStatus
}

interface SubscriptionDiagnosticsResult {
    ok: boolean
    format: 'base64' | 'plain' | 'unknown'
    inputLinksCount: number
    outputLinksCount: number
    groups: Array<{
        publicHostCode: string
        planCode: string
        selectedTechnicalHostName?: string
        status: 'fail-open' | 'no-active-node' | 'ok'
    }>
    vlessValidation: Array<{
        remark?: string
        valid: boolean
        warnings: string[]
        queryParamKeys: string[]
    }>
    warnings: string[]
    errors: string[]
}

const statusLabels: Record<ToporBalancerNodeStatus, string> = {
    active: texts.status.active,
    dead: texts.status.dead,
    disabled: texts.status.disabled,
    draining: texts.status.draining
}

const statusTooltips: Record<ToporBalancerNodeStatus, string> = {
    active: texts.tooltips.active,
    dead: texts.tooltips.dead,
    disabled: texts.tooltips.disabled,
    draining: texts.tooltips.draining
}

const tooltips = texts.tooltips

function formatText(template: string, values: Record<string, number | string>) {
    return Object.entries(values).reduce((current, [key, value]) => current.replaceAll('{{' + key + '}}', String(value)), template)
}

function Help({ label }: { label: string }) {
    return (
        <Tooltip label={label} maw={360} multiline withArrow>
            <ActionIcon aria-label={label} className={classes.helpIcon} radius="xl" size="xs" tabIndex={0} variant="subtle">
                ?
            </ActionIcon>
        </Tooltip>
    )
}

function FieldLabel({ help, label }: { help?: string; label: string }) {
    return (
        <Group gap={4} wrap="nowrap">
            <Text component="span" fw={500} size="sm">
                {label}
            </Text>
            {help && <Help label={help} />}
        </Group>
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

function maskShort(value: string) {
    if (value.length <= 8) {
        return `${value.slice(0, 2)}***`
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function redactSensitiveText(value?: string) {
    if (!value) {
        return '-'
    }

    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer [${texts.common.hidden}]`)
        .replace(/(token|key|secret|password)=([^&\s]+)/gi, `$1=[${texts.common.hidden}]`)
        .replace(/vless:\/\/[^\s]+/gi, `[${texts.common.linkHidden}]`)
        .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, `[${texts.common.uuidHidden}]`)
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, `[${texts.common.ipHidden}]`)
}

function safeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : []
}

function statusOptions() {
    return NODE_STATUSES.map((status) => ({
        label: statusLabels[status],
        value: status
    }))
}

function normalizeTechnicalHostName(value: string) {
    return value.trim()
}

function getDiagnosticsStatusColor(status: SubscriptionDiagnosticsResult['groups'][number]['status']) {
    const colors: Record<SubscriptionDiagnosticsResult['groups'][number]['status'], string> = {
        'fail-open': 'yellow',
        'no-active-node': 'red',
        ok: 'green'
    }

    return colors[status]
}

function getDiagnosticsStatusLabel(status: SubscriptionDiagnosticsResult['groups'][number]['status']) {
    const labels: Record<SubscriptionDiagnosticsResult['groups'][number]['status'], string> = {
        'fail-open': texts.diagnostics.statusFailOpen,
        'no-active-node': texts.diagnostics.statusNoActiveNode,
        ok: texts.diagnostics.statusOk
    }

    return labels[status]
}

export function ToporBalancerAdminPage() {
    const [tokenInput, setTokenInput] = useState('')
    const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY))
    const [health, setHealth] = useState<null | ToporBalancerHealth>(null)
    const [runtimeHealth, setRuntimeHealth] = useState<null | RuntimeConfigHealth>(null)
    const [groups, setGroups] = useState<ToporBalancerGroup[]>([])
    const [nodes, setNodes] = useState<ToporBalancerNode[]>([])
    const [assignments, setAssignments] = useState<ToporBalancerAssignment[]>([])
    const [requests, setRequests] = useState<ToporBalancerRequest[]>([])
    const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([])
    const [selectedHosts, setSelectedHosts] = useState<string[]>([])
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
    const [discoveryImportStatuses, setDiscoveryImportStatuses] = useState<Record<string, DiscoveryImportStatusState>>({})
    const [errorMessage, setErrorMessage] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false)
    const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false)
    const [isImportModalOpen, setIsImportModalOpen] = useState(false)
    const [importMode, setImportMode] = useState<ImportMode>('existing')
    const [importTargetGroupId, setImportTargetGroupId] = useState<string | null>(null)
    const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null)
    const [shortUuid, setShortUuid] = useState('')
    const [diagnosticsShortUuid, setDiagnosticsShortUuid] = useState('')
    const [diagnosticsUserAgentPreset, setDiagnosticsUserAgentPreset] = useState('v2RayTun/6.0')
    const [diagnosticsCustomUserAgent, setDiagnosticsCustomUserAgent] = useState('v2RayTun/6.0')
    const [subscriptionDiagnostics, setSubscriptionDiagnostics] = useState<SubscriptionDiagnosticsResult | null>(null)
    const [groupForm, setGroupForm] = useState({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: '🇫🇮 Finland',
        strategy: 'least_loaded' as ToporBalancerGroupStrategy
    })
    const [nodeForm, setNodeForm] = useState({
        maxUsers: 300,
        status: 'active' as ToporBalancerNodeStatus,
        technicalHostName: '',
        weight: 1
    })
    const [importDefaults, setImportDefaults] = useState({
        maxUsers: 300,
        status: 'active' as ToporBalancerNodeStatus,
        weight: 1
    })
    const [importGroupForm, setImportGroupForm] = useState({
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: '🇫🇮 Finland'
    })

    const isLoggedIn = Boolean(adminToken)
    const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null
    const selectedGroupNodes = useMemo(
        () => nodes.filter((node) => selectedGroup && node.groupId === selectedGroup.id),
        [nodes, selectedGroup]
    )
    const discoveredByTechnicalHostName = useMemo(
        () =>
            new Map(
                discoveredHosts.map((host) => [
                    normalizeTechnicalHostName(host.technicalHostName),
                    host
                ])
            ),
        [discoveredHosts]
    )
    const importedByTechnicalHostName = useMemo(
        () => new Map(nodes.map((node) => [normalizeTechnicalHostName(node.technicalHostName), node])),
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
                setErrorMessage(texts.messages.invalidAdminToken)
                return null
            }

            if (!response.ok) {
                const body = await response.text()
                throw new Error(body || formatText(texts.messages.adminApiStatus, { status: response.status }))
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
            const [healthResponse, runtimeResponse, groupsResponse, nodesResponse, assignmentsResponse, requestsResponse] =
                await Promise.all([
                    fetchAdminJson<ToporBalancerHealth>(ADMIN_HEALTH_URL),
                    fetchAdminJson<RuntimeConfigHealth>(RUNTIME_CONFIG_HEALTH_URL),
                    fetchAdminJson<ToporBalancerGroup[]>(ADMIN_GROUPS_URL),
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

            const nextGroups = safeArray<ToporBalancerGroup>(groupsResponse)

            setGroups(nextGroups)
            setNodes(safeArray<ToporBalancerNode>(nodesResponse))
            setAssignments(safeArray<ToporBalancerAssignment>(assignmentsResponse).slice(0, 500))
            setRequests(safeArray<ToporBalancerRequest>(requestsResponse).slice(0, 500))
            setSelectedGroupId((current) => current ?? nextGroups[0]?.id ?? null)
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.adminApiLoadFailed)
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
        setGroups([])
        setNodes([])
        setAssignments([])
        setRequests([])
        setDiscoveredHosts([])
        setSelectedHosts([])
        setSelectedGroupId(null)
        setDiscoveryImportStatuses({})
        setLastImportResult(null)
        setSubscriptionDiagnostics(null)
    }

    const createGroup = async () => {
        if (!groupForm.publicHostCode.trim() || !groupForm.publicName.trim() || !groupForm.planCode.trim()) {
            notifications.show({
                color: 'red',
                message: texts.messages.requiredGroupFields,
                title: texts.messages.missingData
            })
            return
        }

        setIsLoading(true)

        try {
            const group = await fetchAdminJson<ToporBalancerGroup>(ADMIN_GROUPS_URL, {
                body: JSON.stringify({
                    enabled: groupForm.enabled,
                    locationCode: groupForm.locationCode.trim() || undefined,
                    planCode: groupForm.planCode.trim(),
                    publicHostCode: groupForm.publicHostCode.trim(),
                    publicName: groupForm.publicName.trim(),
                    strategy: groupForm.strategy
                }),
                method: 'POST'
            })

            await refreshAdminData()
            setSelectedGroupId(group?.id ?? null)
            notifications.show({ color: 'green', message: texts.messages.groupCreated, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.groupCreateFailed)
        } finally {
            setIsLoading(false)
        }
    }

    const patchGroup = async (group: ToporBalancerGroup, patch: Partial<ToporBalancerGroup>) => {
        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerGroup>(`${ADMIN_GROUPS_URL}/${group.id}`, {
                body: JSON.stringify(patch),
                method: 'PATCH'
            })
            await refreshAdminData()
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.groupUpdateFailed)
        } finally {
            setIsLoading(false)
        }
    }

    const deleteGroup = async (group: ToporBalancerGroup) => {
        setIsLoading(true)

        try {
            await fetchAdminJson<{ deleted: true }>(`${ADMIN_GROUPS_URL}/${group.id}`, {
                method: 'DELETE'
            })
            await refreshAdminData()
            setSelectedGroupId(null)
            notifications.show({ color: 'green', message: texts.messages.groupDeleted, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : texts.messages.groupDeleteFailed
            )
        } finally {
            setIsLoading(false)
        }
    }

    const createNode = async () => {
        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.messages.selectGroupFirst, title: texts.common.noGroup })
            return
        }

        if (!nodeForm.technicalHostName.trim()) {
            notifications.show({ color: 'red', message: texts.messages.technicalHostRequired, title: texts.messages.missingData })
            return
        }

        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerNode>(`${ADMIN_GROUPS_URL}/${selectedGroup.id}/nodes`, {
                body: JSON.stringify({
                    maxUsers: nodeForm.maxUsers,
                    status: nodeForm.status,
                    technicalHostName: nodeForm.technicalHostName.trim(),
                    weight: nodeForm.weight
                }),
                method: 'POST'
            })
            setNodeForm((current) => ({ ...current, technicalHostName: '' }))
            await refreshAdminData()
            notifications.show({ color: 'green', message: texts.messages.nodeAdded, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.nodeAddFailed)
        } finally {
            setIsLoading(false)
        }
    }

    const patchNode = async (node: ToporBalancerNode, patch: Partial<ToporBalancerNode>) => {
        if (!node.groupId) {
            return
        }

        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerNode>(`${ADMIN_GROUPS_URL}/${node.groupId}/nodes/${node.id}`, {
                body: JSON.stringify(patch),
                method: 'PATCH'
            })
            await refreshAdminData()
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.nodeUpdateFailed)
        } finally {
            setIsLoading(false)
        }
    }

    const deleteNode = async (node: ToporBalancerNode) => {
        if (!node.groupId) {
            return
        }

        setIsLoading(true)

        try {
            await fetchAdminJson<{ deleted: true }>(`${ADMIN_GROUPS_URL}/${node.groupId}/nodes/${node.id}`, {
                method: 'DELETE'
            })
            await refreshAdminData()
            notifications.show({ color: 'green', message: texts.messages.nodeDeleted, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : texts.messages.nodeDeleteFailed
            )
        } finally {
            setIsLoading(false)
        }
    }

    const runApiDiscovery = async () => {
        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
            const response = await fetchAdminJson<DiscoveryResponse>(DISCOVERY_API_URL)
            const items = response?.items ?? []
            setDiscoveredHosts(items)
            setDiscoveryImportStatuses({})
            setLastImportResult(null)
            setSelectedHosts(
                items
                    .filter((item) => !item.alreadyImported)
                    .map((item) => normalizeTechnicalHostName(item.technicalHostName))
            )
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.searchFailed)
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const runSubscriptionDiscovery = async () => {
        const normalizedShortUuid = shortUuid.trim()

        if (!normalizedShortUuid) {
            notifications.show({
                color: 'red',
                message: texts.messages.tokenRequired,
                title: texts.messages.missingData
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
            setDiscoveryImportStatuses({})
            setLastImportResult(null)
            setSelectedHosts(
                items
                    .filter((item) => !item.alreadyImported)
                    .map((item) => normalizeTechnicalHostName(item.technicalHostName))
            )
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.scanFailed)
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const toggleSelectedHost = (technicalHostName: string) => {
        const normalizedTechnicalHostName = normalizeTechnicalHostName(technicalHostName)

        setSelectedHosts((current) =>
            current.includes(normalizedTechnicalHostName)
                ? current.filter((item) => item !== normalizedTechnicalHostName)
                : [...current, normalizedTechnicalHostName]
        )
    }

    const importSelectedHosts = async () => {
        if (selectedHosts.length === 0) {
            notifications.show({
                color: 'red',
                message: texts.discovery.selectAtLeastOne,
                title: texts.messages.missingData
            })
            return
        }

        setImportMode(groups.length > 0 ? 'existing' : 'new')
        setImportTargetGroupId(selectedGroup?.id ?? groups[0]?.id ?? null)
        setLastImportResult(null)
        setIsImportModalOpen(true)
    }

    const performDiscoveryImport = async () => {
        const selected = discoveredHosts.filter((host) =>
            selectedHosts.includes(normalizeTechnicalHostName(host.technicalHostName))
        )

        if (selected.length === 0) {
            return
        }

        const targetGroup = groups.find((group) => group.id === importTargetGroupId) ?? null

        if (importMode === 'existing' && !targetGroup) {
            notifications.show({ color: 'red', message: texts.discovery.targetGroupMissing, title: texts.common.noGroup })
            return
        }

        if (
            importMode === 'new' &&
            (!importGroupForm.publicHostCode.trim() ||
                !importGroupForm.publicName.trim() ||
                !importGroupForm.planCode.trim())
        ) {
            notifications.show({
                color: 'red',
                message: texts.messages.requiredGroupFields,
                title: texts.messages.missingData
            })
            return
        }

        setIsDiscoveryLoading(true)

        try {
            const result = await fetchAdminJson<ImportResult>(DISCOVERY_IMPORT_URL, {
                body: JSON.stringify({
                    ...(importMode === 'existing'
                        ? {
                              groupId: targetGroup?.id
                          }
                        : {
                              group: {
                                  locationCode: importGroupForm.locationCode.trim() || undefined,
                                  planCode: importGroupForm.planCode.trim(),
                                  publicHostCode: importGroupForm.publicHostCode.trim(),
                                  publicName: importGroupForm.publicName.trim()
                              }
                          }),
                    nodes: selected.map((host) => ({
                        maxUsers: importDefaults.maxUsers,
                        status: importDefaults.status,
                        technicalHostName: normalizeTechnicalHostName(host.technicalHostName),
                        weight: importDefaults.weight
                    }))
                }),
                method: 'POST'
            })

            const importedNodes = [
                ...safeArray<ToporBalancerNode>(result?.created),
                ...safeArray<ToporBalancerNode>(result?.updated)
            ]
            const importedByName = new Map(
                importedNodes.map((node) => [normalizeTechnicalHostName(node.technicalHostName), node])
            )
            const skippedNames = new Set(
                safeArray<{ technicalHostName: string }>(result?.skipped).map((item) =>
                    normalizeTechnicalHostName(item.technicalHostName)
                )
            )
            const conflictNames = new Set(
                safeArray<{ technicalHostName: string }>(result?.conflicts).map((item) =>
                    normalizeTechnicalHostName(item.technicalHostName)
                )
            )
            const errorNames = new Set(
                safeArray<{ technicalHostName?: string }>(result?.errors)
                    .map((item) => normalizeTechnicalHostName(item.technicalHostName ?? ''))
                    .filter(Boolean)
            )

            setDiscoveredHosts((current) =>
                current.map((host) => {
                    const importedNode = importedByName.get(normalizeTechnicalHostName(host.technicalHostName))

                    return importedNode
                        ? {
                              ...host,
                              alreadyImported: true,
                              matchedNodeId: importedNode.id,
                              technicalHostName: normalizeTechnicalHostName(host.technicalHostName)
                          }
                        : host
                })
            )
            setDiscoveryImportStatuses((current) => {
                const next = { ...current }

                importedNodes.forEach((node) => {
                    next[normalizeTechnicalHostName(node.technicalHostName)] = {
                        status: 'imported'
                    }
                })
                skippedNames.forEach((technicalHostName) => {
                    next[technicalHostName] = {
                        status: 'skipped',
                        message: texts.discovery.alreadyInGroup
                    }
                })
                safeArray<ImportResult['conflicts'][number]>(result?.conflicts).forEach((conflict) => {
                    next[normalizeTechnicalHostName(conflict.technicalHostName)] = {
                        status: 'conflict',
                        message: `${conflict.existingPublicHostCode ?? '-'}:${conflict.existingPlanCode ?? '-'}`
                    }
                })
                safeArray<{ reason: string; technicalHostName?: string }>(result?.errors).forEach((error) => {
                    if (error.technicalHostName) {
                        next[normalizeTechnicalHostName(error.technicalHostName)] = {
                            status: 'error',
                            message: error.reason
                        }
                    }
                })

                return next
            })
            setSelectedHosts((current) =>
                current.filter((technicalHostName) => {
                    const normalizedTechnicalHostName = normalizeTechnicalHostName(technicalHostName)

                    return (
                        !importedByName.has(normalizedTechnicalHostName) &&
                        !skippedNames.has(normalizedTechnicalHostName)
                    )
                })
            )

            await refreshAdminData()
            setLastImportResult(result)
            notifications.show({
                color: conflictNames.size > 0 || errorNames.size > 0 ? 'yellow' : 'green',
                message: formatText(texts.discovery.importSummaryToast, { created: result?.created.length ?? 0, skipped: result?.skipped.length ?? 0, conflicts: result?.conflicts.length ?? 0 }),
                title: texts.discovery.importFinished
            })
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.importFailed)
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const runSubscriptionDiagnostics = async () => {
        const normalizedShortUuid = diagnosticsShortUuid.trim()

        if (!normalizedShortUuid) {
            notifications.show({
                color: 'red',
                message: texts.messages.tokenRequired,
                title: texts.messages.missingData
            })
            return
        }

        const userAgent =
            diagnosticsUserAgentPreset === 'custom'
                ? diagnosticsCustomUserAgent.trim()
                : diagnosticsUserAgentPreset

        setIsDiagnosticsLoading(true)
        setErrorMessage('')

        try {
            const result = await fetchAdminJson<SubscriptionDiagnosticsResult>(SUBSCRIPTION_DIAGNOSTICS_URL, {
                body: JSON.stringify({
                    shortUuid: normalizedShortUuid,
                    userAgent
                }),
                method: 'POST'
            })

            setSubscriptionDiagnostics(result)
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : texts.messages.subscriptionDiagnosticsFailed)
        } finally {
            setIsDiagnosticsLoading(false)
        }
    }

    const downloadSubscriptionDiagnostics = () => {
        if (!subscriptionDiagnostics) {
            return
        }

        const blob = new Blob([JSON.stringify(subscriptionDiagnostics, null, 2)], {
            type: 'application/json'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = url
        link.download = `topor-subscription-diagnostics-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
    }

    const statusCards = [
        { color: health?.enabled ? 'green' : 'gray', label: 'Balancer', value: health?.enabled ? texts.common.enabled : texts.common.disabled },
        { color: health?.databaseConnected ? 'green' : 'red', label: texts.common.database, value: health?.databaseConnected ? texts.common.connected : texts.common.disconnected },
        { color: 'cyan', label: texts.common.mode, value: health?.assignmentMode ?? '-' },
        { color: 'blue', label: texts.groups.title, value: String(groups.length) },
        { color: 'violet', label: texts.nodes.title, value: String(nodes.length) },
        { color: runtimeHealth?.fallbackConfigOk ? 'green' : 'red', label: texts.common.runtimeConfig, value: runtimeHealth?.fallbackConfigOk ? texts.common.ok : texts.common.problem }
    ]

    return (
        <Page>
            <Modal
                opened={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                size="lg"
                title={texts.discovery.addModalTitle}
            >
                <Stack gap="md">
                    <Text c="dimmed" size="sm">
                        {formatText(texts.discovery.nodesSelected, { count: selectedHosts.length })}
                    </Text>
                    <Tabs onChange={(value) => setImportMode((value as ImportMode | null) ?? 'existing')} value={importMode}>
                        <Tabs.List>
                            <Tabs.Tab disabled={groups.length === 0} value="existing">
                                {texts.discovery.importTargetExisting}
                            </Tabs.Tab>
                            <Tabs.Tab value="new">{texts.discovery.importTargetNew}</Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel pt="md" value="existing">
                            <Stack gap="md">
                                <Select
                                    data={groups.map((group) => ({
                                        label: `${group.publicName} · ${group.publicHostCode}:${group.planCode}`,
                                        value: group.id
                                    }))}
                                    label={texts.fields.group}
                                    onChange={setImportTargetGroupId}
                                    placeholder={texts.discovery.selectGroup}
                                    value={importTargetGroupId}
                                />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="new">
                            <Stack gap="md">
                                <Group grow>
                                    <TextInput
                                        label={<FieldLabel help={tooltips.publicName} label={texts.fields.publicName} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                                        value={importGroupForm.publicName}
                                    />
                                    <TextInput
                                        label={<FieldLabel help={tooltips.publicHostCode} label={texts.fields.publicHostCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                                        value={importGroupForm.publicHostCode}
                                    />
                                </Group>
                                <Group grow>
                                    <TextInput
                                        label={<FieldLabel help={tooltips.locationCode} label={texts.fields.locationCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                                        value={importGroupForm.locationCode}
                                    />
                                    <TextInput
                                        label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                        value={importGroupForm.planCode}
                                    />
                                </Group>
                            </Stack>
                        </Tabs.Panel>
                    </Tabs>

                    <Group grow>
                        <NumberInput
                            label={<FieldLabel help={tooltips.weight} label={texts.fields.weight} />}
                            min={0.0001}
                            onChange={(value) => setImportDefaults((current) => ({ ...current, weight: Number(value) || 1 }))}
                            value={importDefaults.weight}
                        />
                        <NumberInput
                            label={<FieldLabel help={tooltips.maxUsers} label={texts.fields.maxUsers} />}
                            min={1}
                            onChange={(value) => setImportDefaults((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                            value={importDefaults.maxUsers}
                        />
                        <Select
                            data={statusOptions()}
                            label={<FieldLabel help={tooltips.status} label={texts.fields.status} />}
                            onChange={(value) =>
                                setImportDefaults((current) => ({
                                    ...current,
                                    status: (value as ToporBalancerNodeStatus | null) ?? 'active'
                                }))
                            }
                            value={importDefaults.status}
                        />
                    </Group>

                    {lastImportResult && <ImportResultSummary result={lastImportResult} />}

                    <Group justify="flex-end">
                        <Button onClick={() => setIsImportModalOpen(false)} variant="subtle">
                            {texts.actions.close}
                        </Button>
                        <Button leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={performDiscoveryImport}>
                            {texts.actions.import}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
            <Container maw={1440} px={{ base: 'md', sm: 'lg', md: 'xl' }} py="xl">
                <Stack gap="lg">
                    <Group justify="space-between">
                        <Group gap="sm">
                            <IconDatabase className={classes.titleIcon} size={28} />
                            <div>
                                <Title order={2}>{texts.title}</Title>
                                <Text c="dimmed" size="sm">
                                    {texts.subtitle}
                                </Text>
                            </div>
                        </Group>

                        {isLoggedIn && (
                            <Group gap="sm">
                                <Button leftSection={<IconRefresh size={16} />} loading={isLoading} onClick={refreshAdminData} variant="light">
                                    {texts.actions.refresh}
                                </Button>
                                <Button color="red" leftSection={<IconLogout size={16} />} onClick={logout} variant="subtle">
                                    {texts.actions.logout}
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
                                        <Title order={4}>{texts.forms.tokenTitle}</Title>
                                    </Group>
                                    <PasswordInput
                                        autoComplete="current-password"
                                        label={i18n[defaultLocale].admin.tokenLabel}
                                        onChange={(event) => setTokenInput(event.currentTarget.value)}
                                        placeholder={texts.forms.tokenPlaceholder}
                                        value={tokenInput}
                                    />
                                    <Button loading={isLoading} type="submit">
                                        {i18n[defaultLocale].admin.signIn}
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

                            <Tabs defaultValue="groups">
                                <Tabs.List>
                                    <Tabs.Tab value="groups">{texts.tabs.groups}</Tabs.Tab>
                                    <Tabs.Tab value="discovery">{texts.tabs.discovery}</Tabs.Tab>
                                    <Tabs.Tab value="diagnostics">{texts.tabs.diagnostics}</Tabs.Tab>
                                </Tabs.List>

                                <Tabs.Panel pt="md" value="groups">
                                    <Stack gap="md">
                                        <Group align="flex-start" grow>
                                            <Card className={classes.tableCard} p="lg" radius="md">
                                                <Stack gap="md">
                                                    <Group gap="xs">
                                                        <Title order={3}>{texts.forms.groupCreateTitle}</Title>
                                                        <Help label={tooltips.group} />
                                                    </Group>
                                                    <Group grow>
                                                        <TextInput
                                                            label={<FieldLabel help={tooltips.publicName} label={texts.fields.publicName} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                                                            value={groupForm.publicName}
                                                        />
                                                        <TextInput
                                                            label={<FieldLabel help={tooltips.publicHostCode} label={texts.fields.publicHostCode} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                                                            value={groupForm.publicHostCode}
                                                        />
                                                    </Group>
                                                    <Group grow>
                                                        <TextInput
                                                            label={<FieldLabel help={tooltips.locationCode} label={texts.fields.locationCode} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                                                            value={groupForm.locationCode}
                                                        />
                                                        <TextInput
                                                            label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                                            value={groupForm.planCode}
                                                        />
                                                        <Switch
                                                            checked={groupForm.enabled}
                                                            label={texts.common.enabled}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, enabled: event.currentTarget.checked }))}
                                                        />
                                                    </Group>
                                                    <Button leftSection={<IconPlus size={16} />} loading={isLoading} onClick={createGroup}>
                                                        {texts.forms.groupCreateTitle}
                                                    </Button>
                                                </Stack>
                                            </Card>

                                            <Card className={classes.tableCard} p="lg" radius="md">
                                                <Stack gap="md">
                                                    <Title order={3}>{texts.forms.nodeCreateTitle}</Title>
                                                    <Text c="dimmed" size="sm">
                                                        {texts.forms.nodeCreateTarget} {selectedGroup?.publicName ?? '-'}
                                                    </Text>
                                                    <TextInput
                                                        label={<FieldLabel help={tooltips.technicalHostName} label={texts.fields.technicalHostName} />}
                                                        onChange={(event) => setNodeForm((current) => ({ ...current, technicalHostName: event.currentTarget.value }))}
                                                        placeholder="FI-STD-01"
                                                        value={nodeForm.technicalHostName}
                                                    />
                                                    <Group grow>
                                                        <NumberInput
                                                            label={<FieldLabel help={tooltips.weight} label={texts.fields.weight} />}
                                                            min={0.0001}
                                                            onChange={(value) => setNodeForm((current) => ({ ...current, weight: Number(value) || 1 }))}
                                                            value={nodeForm.weight}
                                                        />
                                                        <NumberInput
                                                            label={<FieldLabel help={tooltips.maxUsers} label={texts.fields.maxUsers} />}
                                                            min={1}
                                                            onChange={(value) => setNodeForm((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                                                            value={nodeForm.maxUsers}
                                                        />
                                                        <Select
                                                            data={statusOptions()}
                                                            label={<FieldLabel help={tooltips.status} label={texts.fields.status} />}
                                                            onChange={(value) =>
                                                                setNodeForm((current) => ({
                                                                    ...current,
                                                                    status: (value as ToporBalancerNodeStatus | null) ?? 'active'
                                                                }))
                                                            }
                                                            value={nodeForm.status}
                                                        />
                                                    </Group>
                                                    <Button leftSection={<IconPlus size={16} />} loading={isLoading} onClick={createNode} variant="light">
                                                        {texts.actions.addNode}
                                                    </Button>
                                                </Stack>
                                            </Card>
                                        </Group>

                                        <GroupsTable
                                            deleteGroup={deleteGroup}
                                            groups={groups}
                                            patchGroup={patchGroup}
                                            selectedGroupId={selectedGroup?.id ?? null}
                                            setSelectedGroupId={setSelectedGroupId}
                                        />

                                        <TechnicalNodesTable
                                            deleteNode={deleteNode}
                                            discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                            nodes={selectedGroupNodes}
                                            patchNode={patchNode}
                                        />
                                    </Stack>
                                </Tabs.Panel>

                                <Tabs.Panel pt="md" value="discovery">
                                    <Stack gap="md">
                                        <Card className={classes.tableCard} p="lg" radius="md">
                                            <Stack gap="md">
                                                <Group justify="space-between">
                                                    <div>
                                                        <Title order={3}>{texts.discovery.scanTitle}</Title>
                                                        <Text c="dimmed" size="sm">
                                                            {texts.discovery.importTarget} {selectedGroup?.publicName ?? '-'}
                                                        </Text>
                                                    </div>
                                                    <Badge color={selectedGroup ? 'green' : 'red'} variant="light">
                                                        {selectedGroup ? selectedGroup.publicHostCode : texts.common.noGroup}
                                                    </Badge>
                                                </Group>
                                                <Group align="end">
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runApiDiscovery}>
                                                        {texts.actions.searchRemnawave}
                                                    </Button>
                                                    <TextInput
                                                        label={texts.forms.shortUuidLabel}
                                                        onChange={(event) => setShortUuid(event.currentTarget.value)}
                                                        placeholder={texts.forms.shortUuidPlaceholder}
                                                        value={shortUuid}
                                                    />
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runSubscriptionDiscovery} variant="light">
                                                        {texts.actions.scanSubscription}
                                                    </Button>
                                                </Group>
                                            </Stack>
                                        </Card>

                                        <DiscoveredHostsTable
                                            hosts={discoveredHosts}
                                            importedByTechnicalHostName={importedByTechnicalHostName}
                                            importStatuses={discoveryImportStatuses}
                                            selectedGroup={selectedGroup}
                                            selectedHosts={selectedHosts}
                                            toggleSelectedHost={toggleSelectedHost}
                                        />

                                        <Group justify="flex-end">
                                            <Button disabled={selectedHosts.length === 0} leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={importSelectedHosts}>
                                                {texts.actions.addToGroup}
                                            </Button>
                                        </Group>
                                    </Stack>
                                </Tabs.Panel>

                                <Tabs.Panel pt="md" value="diagnostics">
                                    <Stack gap="md">
                                        <Card className={classes.tableCard} p="lg" radius="md">
                                            <Stack gap="md">
                                                <Group justify="space-between">
                                                    <Title order={3}>{texts.diagnostics.subscriptionTitle}</Title>
                                                    {subscriptionDiagnostics && (
                                                        <Badge color={subscriptionDiagnostics.ok ? 'green' : subscriptionDiagnostics.errors.length > 0 ? 'red' : 'yellow'} variant="light">
                                                            {subscriptionDiagnostics.ok ? texts.diagnostics.resultOk : texts.diagnostics.resultProblem}
                                                        </Badge>
                                                    )}
                                                </Group>
                                                <Group align="end" grow>
                                                    <TextInput
                                                        label={texts.fields.shortUuid}
                                                        onChange={(event) => setDiagnosticsShortUuid(event.currentTarget.value)}
                                                        placeholder={texts.forms.shortUuidPlaceholder}
                                                        value={diagnosticsShortUuid}
                                                    />
                                                    <Select
                                                        data={DIAGNOSTICS_USER_AGENTS}
                                                        label={texts.diagnostics.userAgent}
                                                        onChange={(value) => setDiagnosticsUserAgentPreset(value ?? 'v2RayTun/6.0')}
                                                        value={diagnosticsUserAgentPreset}
                                                    />
                                                    {diagnosticsUserAgentPreset === 'custom' && (
                                                        <TextInput
                                                            label={texts.diagnostics.customUserAgent}
                                                            onChange={(event) => setDiagnosticsCustomUserAgent(event.currentTarget.value)}
                                                            value={diagnosticsCustomUserAgent}
                                                        />
                                                    )}
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiagnosticsLoading} onClick={runSubscriptionDiagnostics}>
                                                        {texts.diagnostics.checkSubscription}
                                                    </Button>
                                                </Group>
                                                {subscriptionDiagnostics && (
                                                    <Stack gap="md">
                                                        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">{texts.diagnostics.format}</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.format}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">{texts.diagnostics.inputLinks}</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.inputLinksCount}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">{texts.diagnostics.outputLinks}</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.outputLinksCount}</Text>
                                                            </Card>
                                                        </SimpleGrid>
                                                        <DiagnosticsSummary result={subscriptionDiagnostics} />
                                                        <Group justify="flex-end">
                                                            <Button leftSection={<IconDownload size={16} />} onClick={downloadSubscriptionDiagnostics} variant="light">
                                                                {texts.diagnostics.downloadReport}
                                                            </Button>
                                                        </Group>
                                                    </Stack>
                                                )}
                                            </Stack>
                                        </Card>
                                        <Alert color={runtimeHealth?.fallbackConfigOk ? 'green' : 'red'} variant="light">
                                            {texts.diagnostics.runtimeConfig}: {runtimeHealth?.appConfigRoute ?? '/assets/.app-config-v2.json'}; {texts.diagnostics.source}: {runtimeHealth?.lastConfigSource ?? '-'}; {texts.diagnostics.error}: {runtimeHealth?.lastRuntimeConfigError ?? '-'}
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

function ImportResultSummary({ result }: { result: ImportResult }) {
    const hasDetails = result.conflicts.length > 0 || (result.errors?.length ?? 0) > 0

    return (
        <Alert color={hasDetails ? 'yellow' : 'green'} variant="light">
            <Stack gap={6}>
                <Text fw={700}>{formatText(texts.discovery.importSummary, { created: result.created.length, skipped: result.skipped.length, conflicts: result.conflicts.length, errors: result.errors?.length ?? 0 })}</Text>
                {result.conflicts.map((conflict) => (
                    <Text key={`conflict-${conflict.technicalHostName}`} size="sm">
                        {conflict.technicalHostName}: {texts.discovery.alreadyInGroup} {conflict.existingPublicHostCode ?? '-'}:
                        {conflict.existingPlanCode ?? '-'}
                    </Text>
                ))}
                {result.errors?.map((error, index) => (
                    <Text key={`error-${error.technicalHostName ?? index}`} size="sm">
                        {error.technicalHostName ?? 'import'}: {error.reason}
                    </Text>
                ))}
            </Stack>
        </Alert>
    )
}

function DiagnosticsSummary({ result }: { result: SubscriptionDiagnosticsResult }) {
    return (
        <Stack gap="md">
            {(result.warnings.length > 0 || result.errors.length > 0) && (
                <Alert color={result.errors.length > 0 ? 'red' : 'yellow'} variant="light">
                    <Stack gap={4}>
                        {result.errors.map((error) => (
                            <Text key={`error-${error}`} size="sm">
                                {error}
                            </Text>
                        ))}
                        {result.warnings.map((warning) => (
                            <Text key={`warning-${warning}`} size="sm">
                                {warning}
                            </Text>
                        ))}
                    </Stack>
                </Alert>
            )}
            <Card className={classes.tableCard} p={0} radius="md">
                <ScrollArea>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>{texts.fields.publicHostCode}</Table.Th>
                                <Table.Th>{texts.fields.planCode}</Table.Th>
                                <Table.Th>{texts.diagnostics.selectedNode}</Table.Th>
                                <Table.Th>{texts.fields.status}</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {result.groups.map((group) => (
                                <Table.Tr key={`${group.publicHostCode}:${group.planCode}`}>
                                    <Table.Td>{group.publicHostCode}</Table.Td>
                                    <Table.Td>{group.planCode}</Table.Td>
                                    <Table.Td>{group.selectedTechnicalHostName ?? '-'}</Table.Td>
                                    <Table.Td>
                                        <Badge color={getDiagnosticsStatusColor(group.status)} variant="light">
                                            {getDiagnosticsStatusLabel(group.status)}
                                        </Badge>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Card>
            <Card className={classes.tableCard} p={0} radius="md">
                <ScrollArea>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>{texts.fields.technicalHostName}</Table.Th>
                                <Table.Th>{texts.fields.status}</Table.Th>
                                <Table.Th>{texts.diagnostics.queryParams}</Table.Th>
                                <Table.Th>{texts.diagnostics.warnings}</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {result.vlessValidation.map((validation, index) => (
                                <Table.Tr key={`${validation.remark ?? 'link'}-${index}`}>
                                    <Table.Td>{validation.remark ?? '-'}</Table.Td>
                                    <Table.Td>
                                        <Badge color={validation.valid ? 'green' : 'red'} variant="light">
                                            {validation.valid ? texts.diagnostics.valid : texts.diagnostics.invalid}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td className={classes.wrapCell}>{validation.queryParamKeys.join(', ') || '-'}</Table.Td>
                                    <Table.Td className={classes.wrapCell}>{validation.warnings.join('; ') || '-'}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Card>
        </Stack>
    )
}

function GroupsTable({
    deleteGroup,
    groups,
    patchGroup,
    selectedGroupId,
    setSelectedGroupId
}: {
    deleteGroup: (group: ToporBalancerGroup) => void
    groups: ToporBalancerGroup[]
    patchGroup: (group: ToporBalancerGroup, patch: Partial<ToporBalancerGroup>) => void
    selectedGroupId: null | string
    setSelectedGroupId: (id: string) => void
}) {
    if (groups.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>{texts.groups.emptyTitle}</Text>
                    <Text c="dimmed" size="sm">
                        {texts.groups.emptyText}
                    </Text>
                </Stack>
            </Card>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.groupsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.publicName}>{texts.fields.publicName}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.publicHostCode}>{texts.fields.publicHostCode}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.locationCode}>{texts.fields.locationCode}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.planCode}>{texts.fields.planCode}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>{texts.fields.strategy}</Table.Th>
                            <Table.Th>{texts.groups.activeNodes}</Table.Th>
                            <Table.Th>{texts.fields.assignedUsers}</Table.Th>
                            <Table.Th>{texts.fields.status}</Table.Th>
                            <Table.Th>{texts.common.actions}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {groups.map((group) => (
                            <Table.Tr key={group.id}>
                                <Table.Td>{group.publicName}</Table.Td>
                                <Table.Td>{group.publicHostCode}</Table.Td>
                                <Table.Td>{group.locationCode || '-'}</Table.Td>
                                <Table.Td>{group.planCode}</Table.Td>
                                <Table.Td>{group.strategy}</Table.Td>
                                <Table.Td>
                                    {group.activeNodesCount}/{group.nodesCount}
                                </Table.Td>
                                <Table.Td>{group.assignedUsers}</Table.Td>
                                <Table.Td>
                                    <Badge color={group.enabled ? 'green' : 'gray'} variant="light">
                                        {group.enabled ? texts.status.groupEnabled : texts.status.groupDisabled}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    <Group gap={6} wrap="nowrap">
                                        <Button
                                            disabled={selectedGroupId === group.id}
                                            onClick={() => setSelectedGroupId(group.id)}
                                            size="xs"
                                            variant="light"
                                        >
                                            {texts.actions.open}
                                        </Button>
                                        <Button
                                            onClick={() => patchGroup(group, { enabled: !group.enabled })}
                                            size="xs"
                                            variant="subtle"
                                        >
                                            {group.enabled ? texts.actions.disable : texts.actions.enable}
                                        </Button>
                                        <Button
                                            color="red"
                                            disabled={group.nodesCount > 0}
                                            leftSection={<IconTrash size={14} />}
                                            onClick={() => deleteGroup(group)}
                                            size="xs"
                                            variant="subtle"
                                        >
                                            {texts.actions.delete}
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

function TechnicalNodesTable({
    deleteNode,
    discoveredByTechnicalHostName,
    nodes,
    patchNode
}: {
    deleteNode: (node: ToporBalancerNode) => void
    discoveredByTechnicalHostName: Map<string, DiscoveredHost>
    nodes: ToporBalancerNode[]
    patchNode: (node: ToporBalancerNode, patch: Partial<ToporBalancerNode>) => void
}) {
    if (nodes.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>{texts.nodes.emptyTitle}</Text>
                    <Text c="dimmed" size="sm">
                        {texts.nodes.emptyText}
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
                                <HeaderWithHelp help={tooltips.technicalHostName}>{texts.fields.technicalHostName}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.status}>{texts.fields.status}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.weight}>{texts.fields.weight}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.maxUsers}>{texts.fields.maxUsers}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>{texts.fields.assignedUsers}</Table.Th>
                            <Table.Th>{texts.fields.importStatus}</Table.Th>
                            <Table.Th>{texts.common.actions}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {nodes.map((node) => {
                            const discoveredHost = discoveredByTechnicalHostName.get(normalizeTechnicalHostName(node.technicalHostName))

                            return (
                                <Table.Tr className={classes[`row-${node.status}`]} key={node.id}>
                                    <Table.Td>{node.technicalHostName}</Table.Td>
                                    <Table.Td>
                                        <Select
                                            data={statusOptions()}
                                            onChange={(value) =>
                                                patchNode(node, {
                                                    status: (value as ToporBalancerNodeStatus | null) ?? node.status
                                                })
                                            }
                                            size="xs"
                                            value={node.status}
                                        />
                                    </Table.Td>
                                    <Table.Td>
                                        <NumberInput
                                            min={0.0001}
                                            onBlur={(event) => patchNode(node, { weight: Number(event.currentTarget.value) || 1 })}
                                            size="xs"
                                            value={node.weight}
                                        />
                                    </Table.Td>
                                    <Table.Td>
                                        <NumberInput
                                            min={1}
                                            onBlur={(event) => patchNode(node, { maxUsers: Number(event.currentTarget.value) || 300 })}
                                            size="xs"
                                            value={node.maxUsers}
                                        />
                                    </Table.Td>
                                    <Table.Td>{node.assignedUsers}</Table.Td>
                                    <Table.Td>
                                        <Badge color={discoveredHost ? 'green' : 'gray'} variant="light">
                                            {discoveredHost ? texts.discovery.discovered : texts.discovery.importedLocal}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group gap={6} wrap="nowrap">
                                            <Button disabled={node.status === 'active'} onClick={() => patchNode(node, { status: 'active' })} size="xs" variant="light">
                                                {texts.actions.enable}
                                            </Button>
                                            <Button disabled={node.status === 'draining'} onClick={() => patchNode(node, { status: 'draining' })} size="xs" variant="light">
                                                {texts.actions.startDraining}
                                            </Button>
                                            <Button color="red" disabled={node.status === 'disabled'} onClick={() => patchNode(node, { status: 'disabled' })} size="xs" variant="subtle">
                                                {texts.actions.disable}
                                            </Button>
                                            <Button color="red" disabled={node.assignedUsers > 0} onClick={() => deleteNode(node)} size="xs" variant="subtle">
                                                {texts.actions.delete}
                                            </Button>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            )
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function getDiscoveredHostStatusBadge({
    importedNode,
    importStatus,
    isImportedIntoSelectedGroup
}: {
    importedNode?: ToporBalancerNode
    importStatus?: DiscoveryImportStatusState
    isImportedIntoSelectedGroup: boolean
}) {
    if (importStatus?.status === 'imported') {
        return { color: 'green', label: texts.discovery.imported, tooltip: texts.tooltips.imported }
    }

    if (importStatus?.status === 'skipped') {
        return { color: 'blue', label: texts.discovery.alreadyInGroup, tooltip: importStatus.message }
    }

    if (importStatus?.status === 'conflict') {
        return { color: 'red', label: texts.discovery.conflict, tooltip: importStatus.message }
    }

    if (importStatus?.status === 'error') {
        return { color: 'red', label: texts.discovery.error, tooltip: importStatus.message }
    }

    if (isImportedIntoSelectedGroup) {
        return { color: 'green', label: texts.discovery.imported, tooltip: texts.tooltips.imported }
    }

    if (importedNode) {
        return {
            color: 'yellow',
            label: texts.discovery.conflict,
            tooltip: `${importedNode.publicHostCode}:${importedNode.planCode}`
        }
    }

    return { color: 'gray', label: texts.discovery.canImport, tooltip: texts.tooltips.discovered }
}

function DiscoveredHostsTable({
    hosts,
    importedByTechnicalHostName,
    importStatuses,
    selectedGroup,
    selectedHosts,
    toggleSelectedHost
}: {
    hosts: DiscoveredHost[]
    importedByTechnicalHostName: Map<string, ToporBalancerNode>
    importStatuses: Record<string, DiscoveryImportStatusState>
    selectedGroup: null | ToporBalancerGroup
    selectedHosts: string[]
    toggleSelectedHost: (technicalHostName: string) => void
}) {
    if (hosts.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>{texts.discovery.emptyTitle}</Text>
                    <Text c="dimmed" size="sm">
                        {texts.discovery.emptyText}
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
                                <HeaderWithHelp help={tooltips.technicalHostName}>{texts.fields.technicalHostName}</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>{texts.fields.importStatus}</Table.Th>
                            <Table.Th>{texts.fields.host}</Table.Th>
                            <Table.Th>{texts.fields.port}</Table.Th>
                            <Table.Th>{texts.fields.protocol}</Table.Th>
                            <Table.Th>{texts.fields.security}</Table.Th>
                            <Table.Th>{texts.fields.type}</Table.Th>
                            <Table.Th>{texts.fields.sni}</Table.Th>
                            <Table.Th>{texts.fields.flow}</Table.Th>
                            <Table.Th>{texts.fields.keys}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {hosts.map((host) => {
                            const technicalHostName = normalizeTechnicalHostName(host.technicalHostName)
                            const importedNode = importedByTechnicalHostName.get(technicalHostName)
                            const importStatus = importStatuses[technicalHostName]
                            const isImportedIntoSelectedGroup = Boolean(
                                selectedGroup &&
                                    importedNode &&
                                    importedNode.groupId === selectedGroup.id
                            )
                            const statusBadge = getDiscoveredHostStatusBadge({
                                importStatus,
                                importedNode,
                                isImportedIntoSelectedGroup
                            })

                            return (
                                <Table.Tr key={technicalHostName}>
                                    <Table.Td>
                                        <Checkbox
                                            checked={selectedHosts.includes(technicalHostName)}
                                            disabled={isImportedIntoSelectedGroup}
                                            onChange={() => toggleSelectedHost(technicalHostName)}
                                        />
                                    </Table.Td>
                                    <Table.Td>{technicalHostName}</Table.Td>
                                    <Table.Td>
                                        <Tooltip disabled={!statusBadge.tooltip} label={statusBadge.tooltip} withArrow>
                                            <Badge color={statusBadge.color} variant="light">
                                                {statusBadge.label}
                                            </Badge>
                                        </Tooltip>
                                    </Table.Td>
                                    <Table.Td>{redactSensitiveText(host.host)}</Table.Td>
                                    <Table.Td>{host.port ?? '-'}</Table.Td>
                                    <Table.Td>{host.protocol ?? '-'}</Table.Td>
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

function AssignmentsTable({ assignments, nodes }: { assignments: ToporBalancerAssignment[]; nodes: ToporBalancerNode[] }) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.assignmentsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{texts.fields.shortUuid}</Table.Th>
                            <Table.Th>{texts.fields.publicHostCode}</Table.Th>
                            <Table.Th>{texts.fields.planCode}</Table.Th>
                            <Table.Th>{texts.fields.technicalHostName}</Table.Th>
                            <Table.Th>{texts.fields.updatedAt}</Table.Th>
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
                            <Table.Th>{texts.fields.createdAt}</Table.Th>
                            <Table.Th>{texts.fields.shortUuid}</Table.Th>
                            <Table.Th>{texts.fields.responseFormat}</Table.Th>
                            <Table.Th>{texts.fields.inputLinksCount}</Table.Th>
                            <Table.Th>{texts.fields.outputLinksCount}</Table.Th>
                            <Table.Th>{texts.fields.status}</Table.Th>
                            <Table.Th>{texts.fields.errorMessage}</Table.Th>
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
