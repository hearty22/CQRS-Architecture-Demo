import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

/**
 * REGLA DE ARQUITECTURA
 *
 * El command side no debe importar, conectar ni saber de la existencia de
 * MongoDB. MongoDB es el read side; el write model vive en Postgres.
 *
 * Esto NO es un comentario: si alguien importa mongodb desde commands/,
 * este test falla.
 */

const COMMANDS_DIR = join(import.meta.dirname, '..', 'src', 'commands')

/**
 * Patrones prohibidos dentro del command side.
 *
 * Cada patron es sobre CODIGO, nunca sobre texto libre: por eso los
 * comentarios se borran antes de buscar. Un docstring que explica la
 * regla no puede hacer fallar el test que la verifica.
 */
const FORBIDDEN = [
  { pattern: /from\s+['"][^'"]*config\/mongodb(\.js)?['"]/, why: 'importa el modulo de conexion de MongoDB' },
  { pattern: /from\s+['"]mongoose(\.js)?['"]/, why: 'importa Mongoose' },
  { pattern: /\brequire\s*\(\s*['"]mongoose/, why: 'requiere mongoose' },
  { pattern: /\bMONGODB_URI\b/, why: 'usa la URI de MongoDB' },
  { pattern: /\bmongoose\.(connect|connection|model|Schema)\b/, why: 'usa la API de mongoose' },
  { pattern: /\bMongoClient\b/, why: 'usa el driver nativo de MongoDB' },
]

function collectTsFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectTsFiles(full))
    } else if (full.endsWith('.ts')) {
      found.push(full)
    }
  }

  return found
}

/** Quita comentarios y strings de plantilla para no buscar en prosa. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('el command side no depende de MongoDB', () => {
  const files = collectTsFiles(COMMANDS_DIR)
  assert.ok(files.length > 0, 'se esperaba al menos un archivo .ts en src/commands')

  const violations: string[] = []

  for (const file of files) {
    const source = codeOnly(readFileSync(file, 'utf8'))

    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(source)) {
        const relative = file.slice(file.indexOf('src/commands'))
        violations.push(`${relative}: ${why} (${pattern})`)
      }
    }
  }

  assert.deepEqual(violations, [], `violaciones de la regla command side:\n${violations.join('\n')}`)
})

test('el detector de la regla funciona (test meta)', () => {
  // Si este test pasa sin mas, la regla de arriba no esta probando nada.
  const badCode = `
    import mongoose from 'mongoose'
    import { connectMongo } from '../config/mongodb.js'
    const mongoose = require('mongoose')
    const uri = process.env.MONGODB_URI
    mongoose.connect(uri)
    const client = new MongoClient(uri)
  `
  const goodCode = `
    // MongoDB es el read side y este modulo no lo toca.
    import { prisma } from '../config/postgres.js'
  `

  for (const { pattern } of FORBIDDEN) {
    assert.ok(pattern.test(codeOnly(badCode)), `el patron ${pattern} deberia detectar codigo prohibido`)
    assert.ok(!pattern.test(codeOnly(goodCode)), `el patron ${pattern} no deberia marcar prosa`)
  }
})

test('el command side no monta endpoints de lectura', () => {
  // En CQRS estricto, un GET sobre la tabla de escritura es el
  // anti-patron: las lecturas van a los read models de MongoDB.
  const files = collectTsFiles(COMMANDS_DIR)
  const violations: string[] = []

  for (const file of files) {
    const source = codeOnly(readFileSync(file, 'utf8'))
    const relative = file.slice(file.indexOf('src/commands'))

    if (/\.(get|put|delete|patch)\s*\(/.test(source)) {
      violations.push(`${relative}: expone un endpoint de lectura/escritura no-create`)
    }
  }

  assert.deepEqual(violations, [], `violaciones:\n${violations.join('\n')}`)
})

/**
 * El query side SI puede conocer MongoDB: es su unica fuente de lectura.
 * Lo que no puede es tocar Postgres, la tabla de escritura.
 */
test('el query side lee solo de MongoDB', () => {
  const files = collectTsFiles(join(import.meta.dirname, '..', 'src', 'queries'))

  for (const file of files) {
    const source = codeOnly(readFileSync(file, 'utf8'))
    const relative = file.slice(file.indexOf('src/queries'))

    assert.ok(
      !/from\s+['"][^'"]*config\/postgres(\.js)?['"]/.test(source),
      `${relative}: el query side no debe conectarse a Postgres`,
    )
    assert.ok(
      !/\bprisma\b\s*\./.test(source),
      `${relative}: el query side no debe usar Prisma`,
    )
  }
})

/**
 * El read path tiene prohibido: PostgreSQL, Redis y la aritmetica en
 * tiempo real. Las tres reglas son verificables y las tres importan.
 */
test('el query side no toca Postgres ni Redis', () => {
  const files = collectTsFiles(join(import.meta.dirname, '..', 'src', 'queries'))

  const forbidden = [
    { pattern: /from\s+['"][^'"]*config\/postgres(\.js)?['"]/, why: 'Postgres (config/postgres)' },
    { pattern: /from\s+['"][^'"]*config\/redis(\.js)?['"]/, why: 'Redis (config/redis)' },
    { pattern: /\bprisma\b/, why: 'Prisma (lado de escritura)' },
    { pattern: /\bredisPublisher\b/, why: 'el publisher de Redis' },
    { pattern: /\bredisSubscriber\b/, why: 'el subscriber de Redis' },
    { pattern: /\bpublish\s*\(/, why: 'publica en el bus' },
  ]

  const violations: string[] = []

  for (const file of files) {
    const source = codeOnly(readFileSync(file, 'utf8'))
    const relative = file.slice(file.indexOf('src/queries'))

    for (const { pattern, why } of forbidden) {
      if (pattern.test(source)) violations.push(`${relative}: usa ${why} (${pattern})`)
    }
  }

  assert.deepEqual(violations, [], `violaciones del read path:\n${violations.join('\n')}`)
})

test('el read path no hace aritmetica sobre los datos', () => {
  // Los totales tienen que venir precalculados del read model. Si el
  // handler divide, multiplica o suma, el endpoint deja de ser O(1) en el
  // sentido de "solo devuelve lo que esta escrito".
  const files = collectTsFiles(join(import.meta.dirname, '..', 'src', 'queries'))

  // Operadores aritmeticos aplicados a campos del documento (totalRevenue,
  // totalRevenueCents, totalOrders). Se excluyen literales de rutas como
  // '/api/stats' y '/100' en un comentario.
  const ARITHMETIC = /(?<field>totalRevenue\w*|totalOrders)\s*[-+*/]\s*|\s[-+*/]\s*(?<field2>totalRevenue\w*|totalOrders)/
  const DIVIDE_FIELD = /[-+*/]\s*100\b/

  const violations: string[] = []

  for (const file of files) {
    const source = codeOnly(readFileSync(file, 'utf8'))
    const relative = file.slice(file.indexOf('src/queries'))

    if (ARITHMETIC.test(source)) {
      violations.push(`${relative}: opera aritmeticamente sobre un campo del read model`)
    }

    // La conversion de centavos a reales es la operacion prohibida por
    // definición: si aparece, el importe no esta precalculado.
    if (DIVIDE_FIELD.test(source)) {
      violations.push(`${relative}: divide por 100 en el read path (deberia estar precalculado)`)
    }
  }

  assert.deepEqual(violations, [], `aritmetica en el read path:\n${violations.join('\n')}`)
})
