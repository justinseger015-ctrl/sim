import { useCallback, useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('useBlockConnections')

interface Field {
  name: string
  type: string
  description?: string
}

export interface ConnectedBlock {
  id: string
  type: string
  outputType: string | string[]
  name: string
  responseFormat?: {
    // Support both formats
    fields?: Field[]
    name?: string
    schema?: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

function parseResponseFormatSafely(responseFormatValue: any, blockId: string): any {
  if (!responseFormatValue) {
    return undefined
  }

  if (typeof responseFormatValue === 'object' && responseFormatValue !== null) {
    return responseFormatValue
  }

  if (typeof responseFormatValue === 'string') {
    const trimmedValue = responseFormatValue.trim()

    if (trimmedValue.startsWith('<') && trimmedValue.includes('>')) {
      return trimmedValue
    }

    if (trimmedValue === '') {
      return undefined
    }

    try {
      return JSON.parse(trimmedValue)
    } catch (error) {
      return undefined
    }
  }
  return undefined
}

// Helper function to extract fields from JSON Schema
function extractFieldsFromSchema(schema: any): Field[] {
  if (!schema || typeof schema !== 'object') {
    return []
  }

  // Handle legacy format with fields array
  if (Array.isArray(schema.fields)) {
    return schema.fields
  }

  // Handle new JSON Schema format
  const schemaObj = schema.schema || schema
  if (!schemaObj || !schemaObj.properties || typeof schemaObj.properties !== 'object') {
    return []
  }

  // Extract fields from schema properties
  return Object.entries(schemaObj.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type || 'string',
    description: prop.description,
  }))
}

export function useBlockConnections(blockId: string) {
  const { edges, blocks } = useWorkflowStore(
    (state) => ({
      edges: state.edges,
      blocks: state.blocks,
    }),
    shallow
  )

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const upstreamNodeIds = useMemo(
    () => BlockPathCalculator.findAllPathNodes(edges, blockId),
    [edges, blockId]
  )

  const directSourceIds = useMemo(
    () =>
      edges
        .filter((edge) => edge.target === blockId)
        .map((edge) => edge.source)
        .filter((sourceId, index, array) => array.indexOf(sourceId) === index),
    [edges, blockId]
  )

  const relevantBlockIds = useMemo(() => {
    const set = new Set<string>([...upstreamNodeIds, ...directSourceIds])
    set.delete(blockId)
    return Array.from(set)
  }, [upstreamNodeIds, directSourceIds, blockId])

  const responseFormatsByBlock = useSubBlockStore(
    useCallback(
      (state) => {
        if (!activeWorkflowId) return {}
        const workflowValues = state.workflowValues[activeWorkflowId] || {}
        const result: Record<string, any> = {}
        relevantBlockIds.forEach((id) => {
          const stored = workflowValues[id]?.responseFormat
          if (stored !== undefined) {
            result[id] = stored
          }
        })
        return result
      },
      [activeWorkflowId, relevantBlockIds]
    ),
    shallow
  )

  const mapToConnectedBlock = useCallback(
    (sourceId: string): ConnectedBlock | null => {
      const sourceBlock = blocks[sourceId]
      if (!sourceBlock) return null

      const responseFormatValue = responseFormatsByBlock[sourceId]
      const responseFormat = parseResponseFormatSafely(responseFormatValue, sourceId)

      const defaultOutputs: Field[] = Object.entries(sourceBlock.outputs || {}).map(([key]) => ({
        name: key,
        type: 'string',
      }))

      const outputFields = responseFormat ? extractFieldsFromSchema(responseFormat) : defaultOutputs

      return {
        id: sourceBlock.id,
        type: sourceBlock.type,
        outputType: outputFields.map((field: Field) => field.name),
        name: sourceBlock.name,
        responseFormat,
      }
    },
    [blocks, responseFormatsByBlock]
  )

  const allPathConnections = useMemo(
    () => upstreamNodeIds.map(mapToConnectedBlock).filter(Boolean) as ConnectedBlock[],
    [upstreamNodeIds, mapToConnectedBlock]
  )

  const directIncomingConnections = useMemo(
    () => directSourceIds.map(mapToConnectedBlock).filter(Boolean) as ConnectedBlock[],
    [directSourceIds, mapToConnectedBlock]
  )

  return {
    incomingConnections: allPathConnections,
    directIncomingConnections,
    hasIncomingConnections: allPathConnections.length > 0,
  }
}
