"use client"

import { useState, useEffect, createContext, useContext, ReactNode } from "react"
import { Settings, Eye, EyeOff, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export type TranslationModel =
  | "sarvam"
  | "openai-gpt4o"
  | "openai-gpt4o-mini"
  | "anthropic-claude"

export type WordMappingModel = TranslationModel | null

export interface TranslationConfig {
  model: TranslationModel
  wordMappingModel: WordMappingModel
  openaiKey: string
  sarvamKey: string
  estimatedTokens: number
}

interface TranslationSettingsContextType {
  config: TranslationConfig
  setModel: (model: TranslationModel) => void
  setWordMappingModel: (model: WordMappingModel) => void
  setOpenAiKey: (key: string) => void
  setSarvamKey: (key: string) => void
  setEstimatedTokens: (tokens: number) => void
}

const TranslationSettingsContext =
  createContext<TranslationSettingsContextType | null>(null)

export function useTranslationSettings() {
  const ctx = useContext(TranslationSettingsContext)
  if (!ctx)
    throw new Error(
      "useTranslationSettings must be used within TranslationSettingsProvider"
    )
  return ctx
}

export const MODEL_INFO: Record<
  TranslationModel,
  { label: string; description: string; costPer1kTokens: number }
> = {
  sarvam: {
    label: "Sarvam (Mayura v1)",
    description: "Fast, specialized for Indian languages",
    costPer1kTokens: 0.5,
  },
  "openai-gpt4o": {
    label: "OpenAI GPT-4O",
    description: "Most accurate, higher cost",
    costPer1kTokens: 3,
  },
  "openai-gpt4o-mini": {
    label: "OpenAI GPT-4O Mini",
    description: "Good quality, faster & cheaper",
    costPer1kTokens: 0.15,
  },
  "anthropic-claude": {
    label: "Anthropic Claude Sonnet",
    description: "High-quality, comparable to GPT-4",
    costPer1kTokens: 3,
  },
}

// ─── RadioCardGroup ────────────────────────────────────────────────────────────

interface RadioCardOption {
  id: string | null
  label: string
  description: string
  cost?: string
}

interface RadioCardGroupProps {
  options: RadioCardOption[]
  value: string | null
  onChange: (value: string | null) => void
}

function RadioCardGroup({ options, value, onChange }: RadioCardGroupProps) {
  return (
    <div className="grid gap-1.5">
      {options.map((opt) => {
        const selected = value === opt.id
        return (
          <div
            key={String(opt.id)}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all",
              selected
                ? "border-2 border-primary bg-primary/5"
                : "border border-border hover:border-primary/40"
            )}
          >
            {/* Radio dot */}
            <div
              className={cn(
                "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                selected ? "border-primary" : "border-muted-foreground/40"
              )}
            >
              {selected && (
                <div className="w-2 h-2 rounded-full bg-primary" />
              )}
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium leading-tight",
                  selected ? "text-primary" : "text-foreground"
                )}
              >
                {opt.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {opt.description}
              </p>
              {opt.cost && (
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {opt.cost}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Build option arrays ───────────────────────────────────────────────────────

const MODEL_OPTIONS: RadioCardOption[] = (
  Object.entries(MODEL_INFO) as [TranslationModel, (typeof MODEL_INFO)[TranslationModel]][]
).map(([id, info]) => ({
  id,
  label: info.label,
  description: info.description,
  cost: `~$${(info.costPer1kTokens / 100).toFixed(4)} per 1k tokens`,
}))

const WORD_MAPPING_OPTIONS: RadioCardOption[] = [
  {
    id: null,
    label: "None",
    description: "Disable word mapping",
  },
  ...MODEL_OPTIONS,
]

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TranslationSettingsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [config, setConfig] = useState<TranslationConfig>({
    model: "openai-gpt4o-mini",
    wordMappingModel: null,
    openaiKey: "",
    sarvamKey: "",
    estimatedTokens: 0,
  })

  useEffect(() => {
    try {
      const saved = localStorage.getItem("translationConfig")
      if (saved) {
        const parsed = JSON.parse(saved)
        setConfig((prev) => ({ ...prev, ...parsed }))
      }
    } catch (e) {
      console.warn("Failed to load translation config from localStorage", e)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("translationConfig", JSON.stringify(config))
  }, [config])

  const setModel = (model: TranslationModel) =>
    setConfig((p) => ({ ...p, model }))
  const setWordMappingModel = (wordMappingModel: WordMappingModel) =>
    setConfig((p) => ({ ...p, wordMappingModel }))
  const setOpenAiKey = (openaiKey: string) =>
    setConfig((p) => ({ ...p, openaiKey }))
  const setSarvamKey = (sarvamKey: string) =>
    setConfig((p) => ({ ...p, sarvamKey }))
  const setEstimatedTokens = (estimatedTokens: number) =>
    setConfig((p) => ({ ...p, estimatedTokens }))

  return (
    <TranslationSettingsContext.Provider
      value={{
        config,
        setModel,
        setWordMappingModel,
        setOpenAiKey,
        setSarvamKey,
        setEstimatedTokens,
      }}
    >
      {children}
    </TranslationSettingsContext.Provider>
  )
}

// ─── Which API key each model needs ───────────────────────────────────────────

type ApiKeyProvider = "openai" | "sarvam" | "anthropic"

const MODEL_KEY_PROVIDER: Record<TranslationModel, ApiKeyProvider> = {
  sarvam: "sarvam",
  "openai-gpt4o": "openai",
  "openai-gpt4o-mini": "openai",
  "anthropic-claude": "anthropic",
}

// ─── Key validation helper ────────────────────────────────────────────────────

/** Returns the missing provider name, or null if all keys are present. */
/** Key check for the translation model only. */
export function getMissingTranslationKey(config: TranslationConfig): ApiKeyProvider | null {
  const provider = MODEL_KEY_PROVIDER[config.model]
  const keyMap: Record<ApiKeyProvider, string> = {
    openai:    config.openaiKey,
    sarvam:    config.sarvamKey,
    anthropic: "",
  }
  return keyMap[provider] ? null : provider
}

/** Key check for the word mapping model. Returns null if no model selected. */
export function getMissingWordMappingKey(config: TranslationConfig): ApiKeyProvider | null {
  if (!config.wordMappingModel) return null
  const provider = MODEL_KEY_PROVIDER[config.wordMappingModel]
  const keyMap: Record<ApiKeyProvider, string> = {
    openai:    config.openaiKey,
    sarvam:    config.sarvamKey,
    anthropic: "",
  }
  return keyMap[provider] ? null : provider
}
export const PROVIDER_LABEL: Record<ApiKeyProvider, string> = {
  openai:    "OpenAI",
  sarvam:    "Sarvam",
  anthropic: "Anthropic",
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

export function TranslationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { config, setModel, setWordMappingModel, setOpenAiKey, setSarvamKey } =
    useTranslationSettings()
  const [showKeys, setShowKeys] = useState<Record<ApiKeyProvider, boolean>>({
    openai: false,
    sarvam: false,
    anthropic: false,
  })
  const [copiedKey, setCopiedKey] = useState<ApiKeyProvider | null>(null)

  const copyToClipboard = (text: string, provider: ApiKeyProvider) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(provider)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const toggleShow = (provider: ApiKeyProvider) =>
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }))

  // Collect the unique providers needed by the currently selected models
  const selectedModels = [
    config.model,
    ...(config.wordMappingModel ? [config.wordMappingModel] : []),
  ]
  const neededProviders = Array.from(
    new Set(selectedModels.map((m) => MODEL_KEY_PROVIDER[m]))
  )

  const KEY_CONFIG: Record<
    ApiKeyProvider,
    {
      label: string
      placeholder: string
      value: string
      setter: (v: string) => void
      docsUrl: string
      docsLabel: string
    }
  > = {
    openai: {
      label: "OpenAI API Key",
      placeholder: "sk-...",
      value: config.openaiKey,
      setter: setOpenAiKey,
      docsUrl: "https://platform.openai.com/api-keys",
      docsLabel: "platform.openai.com",
    },
    sarvam: {
      label: "Sarvam API Key",
      placeholder: "api-...",
      value: config.sarvamKey,
      setter: setSarvamKey,
      docsUrl: "https://sarvam.ai",
      docsLabel: "sarvam.ai",
    },
    anthropic: {
      label: "Anthropic API Key",
      placeholder: "sk-ant-...",
      value: "",
      setter: () => {},
      docsUrl: "https://console.anthropic.com/settings/keys",
      docsLabel: "console.anthropic.com",
    },
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings size={18} />
            Translation Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">

          {/* Translation model */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Translation model</h3>
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                Required
              </Badge>
            </div>
            <RadioCardGroup
              options={MODEL_OPTIONS}
              value={config.model}
              onChange={(v) => v && setModel(v as TranslationModel)}
            />
          </div>

          <Separator />

          {/* Word mapping model */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Word mapping model</h3>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                Optional
              </Badge>
            </div>
            <RadioCardGroup
              options={WORD_MAPPING_OPTIONS}
              value={config.wordMappingModel}
              onChange={(v) => setWordMappingModel(v as WordMappingModel)}
            />
          </div>

          <Separator />

          {/* API Keys — only for providers required by selected models */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">API Keys</h3>
            <p className="text-xs text-muted-foreground">
              Keys are stored locally in your browser only. Never shared with
              our servers.
            </p>

            {neededProviders.map((provider) => {
              const kc = KEY_CONFIG[provider]
              const configured = !!kc.value
              return (
                <div key={provider} className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    {kc.label}
                    {configured && (
                      <Badge variant="secondary" className="text-[10px]">
                        Configured
                      </Badge>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Input
                        type={showKeys[provider] ? "text" : "password"}
                        placeholder={kc.placeholder}
                        value={kc.value}
                        onChange={(e) => kc.setter(e.target.value)}
                        className="pr-10"
                      />
                      <button
                        onClick={() => toggleShow(provider)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKeys[provider] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {configured && (
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copyToClipboard(kc.value, provider)}
                      >
                        {copiedKey === provider ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get your key at{" "}
                    <a
                      href={kc.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {kc.docsLabel}
                    </a>
                  </p>
                </div>
              )
            })}
          </div>

          <Separator />

          {/* Info */}
          <Card className="bg-muted/30 border-0">
            <CardContent className="pt-4 space-y-2 text-xs">
              <p>
                <strong>Note:</strong> Sarvam is required for basic
                word-mapping translation. OpenAI is used for AI-assisted
                semantic grouping when enabled.
              </p>
              <p>
                Your keys are saved in your browser's local storage and never
                sent to our servers unless you initiate a translation.
              </p>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}