import Ajv, { ValidateFunction, ErrorObject } from "ajv"
import Ajvi18n from "ajv-i18n/localize/fr"
import draft07 from './draft-07-schema.json'

const AJV = new Ajv({ strictNumbers: false, strictSchema: false, coerceTypes: true })
AJV.addFormat("color", /./)
AJV.addFormat("signature", /./)
AJV.addFormat("password", /./)
AJV.addFormat("doc", /./)
AJV.addFormat("uuid", /./)
AJV.addFormat("geo", /./)
AJV.addFormat("markdown", /./)
AJV.addFormat("asset", /./)
AJV.addFormat("date", /./)
AJV.addFormat("time", /./)
AJV.addFormat("date-time", /./)
AJV.addFormat("email", /./)
const VALIDATESHEMA = AJV.compile(draft07)



type AnyJson = boolean | number | string | null | JsonArray | JsonMap;
interface JsonMap { [key: string]: AnyJson; }
interface JsonArray extends Array<AnyJson> { }

type DynSchema = SchemaDefinition
type SchemaPrimitive = "array" | "boolean" | "integer" | "null" | "number" | "object" | "string"
type SchemaType = SchemaPrimitive | SchemaPrimitive[]
type SchemaFuncBoolean = (value, parent, schema, root, $: (ptr: string) => any) => boolean
type SchemaDefinition = {
    type: SchemaType
    $id?: string
    $schema?: string
    $ref?: string
    $comment?: string
    title?: string
    description?: string
    default?: any
    readOnly?: boolean
    writeOnly?: boolean
    examples?: any[]
    multipleOf?: number
    maximum?: number
    exclusiveMaximum?: number
    minimum?: number
    exclusiveMinimum?: number
    additionalItems?: SchemaDefinition,
    maxLength?: number
    minLength?: number
    pattern?: string
    items?: SchemaDefinition
    maxItems?: number
    minItems?: number
    uniqueItems?: boolean
    contains?: SchemaDefinition
    maxProperties?: number
    minProperties?: number
    required?: string[]
    additionalProperties?: SchemaDefinition | boolean
    definitions?: { [defname: string]: SchemaDefinition }
    properties?: SchemaDefinition
    patternProperties?: string
    dependencies?: SchemaDefinition
    propertyNames?: string,
    const?: any,
    enum?: any[]
    format: string
    contentMediaType: string
    contentEncoding: string
    if?: SchemaDefinition,
    then?: SchemaDefinition,
    else?: SchemaDefinition,
    allOf?: SchemaDefinition[]
    anyOf?: SchemaDefinition[]
    oneOf?: SchemaDefinition[]
    not?: SchemaDefinition

    // added for Form behavior
    composed?: boolean
    isInstance: SchemaFuncBoolean
    nullable?: boolean
    transient?: boolean
}

type DynKey = number | string
type DynMetadata = {
    pointer: string
    schema: DynSchema
    root: DynJson
    parent?: DynJson
    key?: DynKey
}

const METADATA = Symbol()
const META = Symbol()

interface DynJson {
    get [META](): DynMetadata
    toJSON(): string
}

class DynObject extends Object implements DynJson {
    private readonly [METADATA]: DynMetadata = {} as DynMetadata
    constructor(value: { [x: string]: DynJson }) {
        super()
        Object.entries(value).forEach(([propname, propval]) => this[propname] = propval)
    }
    get [META]() { return this[METADATA] }
    toJSON() { return JSON.stringify(this) }
}



class DynArray extends Array implements DynJson {
    constructor(value: DynJson[]) {
        super()
        const array = new Array(...value)
        Object.defineProperty(array, METADATA, { value: {} })
        Object.defineProperty(array, META, { get: () => array[METADATA] })
        return array as never
    }
    get [META]() { throw 'Error if called !!! '; return {} as never }
    toJSON() { throw 'Error if called !!! '; return '' }

}

class DynNull implements DynJson {
    private readonly [METADATA]: DynMetadata = {} as DynMetadata
    get [META]() { return this[METADATA] }
    toJSON() { return JSON.stringify(this) }
}

class DynUndefined implements DynJson {
    private readonly [METADATA]: DynMetadata = {} as DynMetadata
    get [META]() { return this[METADATA] }
    toJSON() { return '' }
}

class DynNumber extends Number implements DynJson {
    private readonly [METADATA]: DynMetadata = {} as DynMetadata
    get [META]() { return this[METADATA] }
    toJSON() { return String(this) }
}

class DynBoolean extends Boolean implements DynJson {
    private readonly [METADATA]: DynMetadata = {} as DynMetadata
    get [META]() { return this[METADATA] }
    toJSON() { return JSON.stringify(this) }
}

class DynString extends String implements DynJson {
    private readonly [METADATA]: DynMetadata = {} as DynMetadata
    get [META]() { return this[METADATA] }
    toJSON() { return JSON.stringify(this.toString()) }
}

type WalkAction = (data: DynJson, schema: DynSchema, pdata?: DynJson, key?: DynKey) => void
type WalkActions = WalkAction[]

export const walkDynJson = (djs: DynJson, dsch: DynSchema, actions: WalkActions, pdjs?: DynJson, key?: DynKey) => {
    actions.forEach(action => action(djs, dsch, pdjs, key))
    if (djs instanceof DynArray && djs instanceof Array) {
        if (dsch.composed) {
            djs.forEach((item, index) => {
                const composition = dsch.items?.oneOf ?? dsch.items?.anyOf ?? dsch.items?.allOf ?? []
                composition.forEach((schema: any) => {
                    if (schema.isInstance && schema.isInstance(null, item, djs, index, () => null))
                        walkDynJson(item, schema, actions, djs, index)
                })
            })
        } else {
            djs.forEach((item, index) => dsch.items && walkDynJson(item, dsch.items, actions, djs, index))
        }
    }
    if (djs instanceof DynObject) {
        Object.entries(djs).forEach(([propname, propval]: [string, DynJson]) => {
            const propschema = dsch.properties?.[propname]
            if (propschema) walkDynJson(propval, propschema, actions, djs, propname)
        })
    }
}

const compileMeta: WalkAction = function (data: DynJson, schema: DynSchema, parent?: DynJson, key?: DynKey) {
    if (parent != null && key != null) {
        data[META].pointer = `${parent[META].pointer}/${key}`
        data[META].schema = schema
        data[META].root = parent[META].root
        data[META].parent = parent
        data[META].key = key
    } else {
        data[META].pointer = "#"
        data[META].schema = schema
        data[META].root = data
    }
}

class DYNAMIC {
    static compile(rootJson: DynJson, rootSchema: DynSchema, doValidation=false) {

        // DRAFT for SCHEMA ORG not imported
        if (!VALIDATESHEMA) throw Error("reference Draft07 not validated !")

        // provided SCHEMA validation
        if (!VALIDATESHEMA(rootSchema)) {
            const errors = VALIDATESHEMA.errors 
            const errString = errors?.map(error => `at ${error.instancePath} keyword:${error.keyword} error:${error.message} for ${error.params.keys().join(',')} `).join("\n")
            throw Error(`Schema not valid du to => ${errString}`)
        }
    
        // provided data validation
        if (doValidation) {
            const validate = AJV.compile(rootSchema)
        }

        // first compilation stage is to evaluate "METADATA"
        walkDynJson(rootJson, rootSchema, [compileMeta])
    }

    static parse(jsonString: string, dynSchema: DynSchema): DynJson {
        const reviver = function (this: DynJson, name: DynKey, value: any): DynJson {
            switch (true) {
                case typeof value == "string": return new DynString(value)
                case typeof value == "number": return new DynNumber(value)
                case typeof value == "boolean": return new DynBoolean(value)
                case Array.isArray(value): return new DynArray(value)
                case value != null: return new DynObject(value)
            }
            return new DynNull()
        }
        const dynJson = JSON.parse(jsonString, reviver) as DynJson
        DYNAMIC.compile(dynJson, dynSchema)
        return dynJson
    }
    static stringify(value: DynJson): string {
        const replacer = function (this: DynJson, name: string, value: DynJson) {
            const parentSchema = this[META].schema
            const schema = value[META].schema
            // un schema dit transient retourne toujours undefined
            if (value[META].schema.transient)  return undefined
            if (value instanceof DynArray && value instanceof Array) {
                if (value.length === 0) return schema.nullable ? null : undefined
            }
            if (value instanceof DynObject) {
                if (Object.values(value).every(value => value == null)) return schema.nullable ? null : undefined
            }
            if (value == null) return schema.nullable ? null : undefined
        }
        return JSON.stringify(value, replacer)
    }
}


