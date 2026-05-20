import { en } from './en'
import { ru } from './ru'

export const i18n = {
    en,
    ru
} as const

export type ToporLocale = keyof typeof i18n

export const defaultLocale: ToporLocale = 'ru'
