
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Project
 * 
 */
export type Project = $Result.DefaultSelection<Prisma.$ProjectPayload>
/**
 * Model Task
 * 
 */
export type Task = $Result.DefaultSelection<Prisma.$TaskPayload>
/**
 * Model TaskStep
 * 
 */
export type TaskStep = $Result.DefaultSelection<Prisma.$TaskStepPayload>
/**
 * Model TaskTrace
 * 
 */
export type TaskTrace = $Result.DefaultSelection<Prisma.$TaskTracePayload>
/**
 * Model TaskDiff
 * 
 */
export type TaskDiff = $Result.DefaultSelection<Prisma.$TaskDiffPayload>
/**
 * Model AgentRun
 * 
 */
export type AgentRun = $Result.DefaultSelection<Prisma.$AgentRunPayload>
/**
 * Model TraceSpan
 * 
 */
export type TraceSpan = $Result.DefaultSelection<Prisma.$TraceSpanPayload>
/**
 * Model ProviderConfig
 * 
 */
export type ProviderConfig = $Result.DefaultSelection<Prisma.$ProviderConfigPayload>
/**
 * Model SkillArtifact
 * 
 */
export type SkillArtifact = $Result.DefaultSelection<Prisma.$SkillArtifactPayload>
/**
 * Model PromptVersion
 * 
 */
export type PromptVersion = $Result.DefaultSelection<Prisma.$PromptVersionPayload>

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Projects
 * const projects = await prisma.project.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Projects
   * const projects = await prisma.project.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.project`: Exposes CRUD operations for the **Project** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Projects
    * const projects = await prisma.project.findMany()
    * ```
    */
  get project(): Prisma.ProjectDelegate<ExtArgs>;

  /**
   * `prisma.task`: Exposes CRUD operations for the **Task** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Tasks
    * const tasks = await prisma.task.findMany()
    * ```
    */
  get task(): Prisma.TaskDelegate<ExtArgs>;

  /**
   * `prisma.taskStep`: Exposes CRUD operations for the **TaskStep** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TaskSteps
    * const taskSteps = await prisma.taskStep.findMany()
    * ```
    */
  get taskStep(): Prisma.TaskStepDelegate<ExtArgs>;

  /**
   * `prisma.taskTrace`: Exposes CRUD operations for the **TaskTrace** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TaskTraces
    * const taskTraces = await prisma.taskTrace.findMany()
    * ```
    */
  get taskTrace(): Prisma.TaskTraceDelegate<ExtArgs>;

  /**
   * `prisma.taskDiff`: Exposes CRUD operations for the **TaskDiff** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TaskDiffs
    * const taskDiffs = await prisma.taskDiff.findMany()
    * ```
    */
  get taskDiff(): Prisma.TaskDiffDelegate<ExtArgs>;

  /**
   * `prisma.agentRun`: Exposes CRUD operations for the **AgentRun** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AgentRuns
    * const agentRuns = await prisma.agentRun.findMany()
    * ```
    */
  get agentRun(): Prisma.AgentRunDelegate<ExtArgs>;

  /**
   * `prisma.traceSpan`: Exposes CRUD operations for the **TraceSpan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TraceSpans
    * const traceSpans = await prisma.traceSpan.findMany()
    * ```
    */
  get traceSpan(): Prisma.TraceSpanDelegate<ExtArgs>;

  /**
   * `prisma.providerConfig`: Exposes CRUD operations for the **ProviderConfig** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ProviderConfigs
    * const providerConfigs = await prisma.providerConfig.findMany()
    * ```
    */
  get providerConfig(): Prisma.ProviderConfigDelegate<ExtArgs>;

  /**
   * `prisma.skillArtifact`: Exposes CRUD operations for the **SkillArtifact** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more SkillArtifacts
    * const skillArtifacts = await prisma.skillArtifact.findMany()
    * ```
    */
  get skillArtifact(): Prisma.SkillArtifactDelegate<ExtArgs>;

  /**
   * `prisma.promptVersion`: Exposes CRUD operations for the **PromptVersion** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PromptVersions
    * const promptVersions = await prisma.promptVersion.findMany()
    * ```
    */
  get promptVersion(): Prisma.PromptVersionDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Project: 'Project',
    Task: 'Task',
    TaskStep: 'TaskStep',
    TaskTrace: 'TaskTrace',
    TaskDiff: 'TaskDiff',
    AgentRun: 'AgentRun',
    TraceSpan: 'TraceSpan',
    ProviderConfig: 'ProviderConfig',
    SkillArtifact: 'SkillArtifact',
    PromptVersion: 'PromptVersion'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "project" | "task" | "taskStep" | "taskTrace" | "taskDiff" | "agentRun" | "traceSpan" | "providerConfig" | "skillArtifact" | "promptVersion"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Project: {
        payload: Prisma.$ProjectPayload<ExtArgs>
        fields: Prisma.ProjectFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ProjectFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ProjectFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          findFirst: {
            args: Prisma.ProjectFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ProjectFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          findMany: {
            args: Prisma.ProjectFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>[]
          }
          create: {
            args: Prisma.ProjectCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          createMany: {
            args: Prisma.ProjectCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ProjectCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>[]
          }
          delete: {
            args: Prisma.ProjectDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          update: {
            args: Prisma.ProjectUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          deleteMany: {
            args: Prisma.ProjectDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ProjectUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ProjectUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          aggregate: {
            args: Prisma.ProjectAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateProject>
          }
          groupBy: {
            args: Prisma.ProjectGroupByArgs<ExtArgs>
            result: $Utils.Optional<ProjectGroupByOutputType>[]
          }
          count: {
            args: Prisma.ProjectCountArgs<ExtArgs>
            result: $Utils.Optional<ProjectCountAggregateOutputType> | number
          }
        }
      }
      Task: {
        payload: Prisma.$TaskPayload<ExtArgs>
        fields: Prisma.TaskFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TaskFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TaskFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>
          }
          findFirst: {
            args: Prisma.TaskFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TaskFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>
          }
          findMany: {
            args: Prisma.TaskFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>[]
          }
          create: {
            args: Prisma.TaskCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>
          }
          createMany: {
            args: Prisma.TaskCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TaskCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>[]
          }
          delete: {
            args: Prisma.TaskDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>
          }
          update: {
            args: Prisma.TaskUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>
          }
          deleteMany: {
            args: Prisma.TaskDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TaskUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TaskUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskPayload>
          }
          aggregate: {
            args: Prisma.TaskAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTask>
          }
          groupBy: {
            args: Prisma.TaskGroupByArgs<ExtArgs>
            result: $Utils.Optional<TaskGroupByOutputType>[]
          }
          count: {
            args: Prisma.TaskCountArgs<ExtArgs>
            result: $Utils.Optional<TaskCountAggregateOutputType> | number
          }
        }
      }
      TaskStep: {
        payload: Prisma.$TaskStepPayload<ExtArgs>
        fields: Prisma.TaskStepFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TaskStepFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TaskStepFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>
          }
          findFirst: {
            args: Prisma.TaskStepFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TaskStepFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>
          }
          findMany: {
            args: Prisma.TaskStepFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>[]
          }
          create: {
            args: Prisma.TaskStepCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>
          }
          createMany: {
            args: Prisma.TaskStepCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TaskStepCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>[]
          }
          delete: {
            args: Prisma.TaskStepDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>
          }
          update: {
            args: Prisma.TaskStepUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>
          }
          deleteMany: {
            args: Prisma.TaskStepDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TaskStepUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TaskStepUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskStepPayload>
          }
          aggregate: {
            args: Prisma.TaskStepAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTaskStep>
          }
          groupBy: {
            args: Prisma.TaskStepGroupByArgs<ExtArgs>
            result: $Utils.Optional<TaskStepGroupByOutputType>[]
          }
          count: {
            args: Prisma.TaskStepCountArgs<ExtArgs>
            result: $Utils.Optional<TaskStepCountAggregateOutputType> | number
          }
        }
      }
      TaskTrace: {
        payload: Prisma.$TaskTracePayload<ExtArgs>
        fields: Prisma.TaskTraceFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TaskTraceFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TaskTraceFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>
          }
          findFirst: {
            args: Prisma.TaskTraceFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TaskTraceFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>
          }
          findMany: {
            args: Prisma.TaskTraceFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>[]
          }
          create: {
            args: Prisma.TaskTraceCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>
          }
          createMany: {
            args: Prisma.TaskTraceCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TaskTraceCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>[]
          }
          delete: {
            args: Prisma.TaskTraceDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>
          }
          update: {
            args: Prisma.TaskTraceUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>
          }
          deleteMany: {
            args: Prisma.TaskTraceDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TaskTraceUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TaskTraceUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskTracePayload>
          }
          aggregate: {
            args: Prisma.TaskTraceAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTaskTrace>
          }
          groupBy: {
            args: Prisma.TaskTraceGroupByArgs<ExtArgs>
            result: $Utils.Optional<TaskTraceGroupByOutputType>[]
          }
          count: {
            args: Prisma.TaskTraceCountArgs<ExtArgs>
            result: $Utils.Optional<TaskTraceCountAggregateOutputType> | number
          }
        }
      }
      TaskDiff: {
        payload: Prisma.$TaskDiffPayload<ExtArgs>
        fields: Prisma.TaskDiffFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TaskDiffFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TaskDiffFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>
          }
          findFirst: {
            args: Prisma.TaskDiffFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TaskDiffFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>
          }
          findMany: {
            args: Prisma.TaskDiffFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>[]
          }
          create: {
            args: Prisma.TaskDiffCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>
          }
          createMany: {
            args: Prisma.TaskDiffCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TaskDiffCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>[]
          }
          delete: {
            args: Prisma.TaskDiffDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>
          }
          update: {
            args: Prisma.TaskDiffUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>
          }
          deleteMany: {
            args: Prisma.TaskDiffDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TaskDiffUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TaskDiffUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TaskDiffPayload>
          }
          aggregate: {
            args: Prisma.TaskDiffAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTaskDiff>
          }
          groupBy: {
            args: Prisma.TaskDiffGroupByArgs<ExtArgs>
            result: $Utils.Optional<TaskDiffGroupByOutputType>[]
          }
          count: {
            args: Prisma.TaskDiffCountArgs<ExtArgs>
            result: $Utils.Optional<TaskDiffCountAggregateOutputType> | number
          }
        }
      }
      AgentRun: {
        payload: Prisma.$AgentRunPayload<ExtArgs>
        fields: Prisma.AgentRunFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AgentRunFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AgentRunFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          findFirst: {
            args: Prisma.AgentRunFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AgentRunFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          findMany: {
            args: Prisma.AgentRunFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>[]
          }
          create: {
            args: Prisma.AgentRunCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          createMany: {
            args: Prisma.AgentRunCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AgentRunCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>[]
          }
          delete: {
            args: Prisma.AgentRunDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          update: {
            args: Prisma.AgentRunUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          deleteMany: {
            args: Prisma.AgentRunDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AgentRunUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AgentRunUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentRunPayload>
          }
          aggregate: {
            args: Prisma.AgentRunAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgentRun>
          }
          groupBy: {
            args: Prisma.AgentRunGroupByArgs<ExtArgs>
            result: $Utils.Optional<AgentRunGroupByOutputType>[]
          }
          count: {
            args: Prisma.AgentRunCountArgs<ExtArgs>
            result: $Utils.Optional<AgentRunCountAggregateOutputType> | number
          }
        }
      }
      TraceSpan: {
        payload: Prisma.$TraceSpanPayload<ExtArgs>
        fields: Prisma.TraceSpanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TraceSpanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TraceSpanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>
          }
          findFirst: {
            args: Prisma.TraceSpanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TraceSpanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>
          }
          findMany: {
            args: Prisma.TraceSpanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>[]
          }
          create: {
            args: Prisma.TraceSpanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>
          }
          createMany: {
            args: Prisma.TraceSpanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TraceSpanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>[]
          }
          delete: {
            args: Prisma.TraceSpanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>
          }
          update: {
            args: Prisma.TraceSpanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>
          }
          deleteMany: {
            args: Prisma.TraceSpanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TraceSpanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TraceSpanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TraceSpanPayload>
          }
          aggregate: {
            args: Prisma.TraceSpanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTraceSpan>
          }
          groupBy: {
            args: Prisma.TraceSpanGroupByArgs<ExtArgs>
            result: $Utils.Optional<TraceSpanGroupByOutputType>[]
          }
          count: {
            args: Prisma.TraceSpanCountArgs<ExtArgs>
            result: $Utils.Optional<TraceSpanCountAggregateOutputType> | number
          }
        }
      }
      ProviderConfig: {
        payload: Prisma.$ProviderConfigPayload<ExtArgs>
        fields: Prisma.ProviderConfigFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ProviderConfigFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ProviderConfigFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>
          }
          findFirst: {
            args: Prisma.ProviderConfigFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ProviderConfigFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>
          }
          findMany: {
            args: Prisma.ProviderConfigFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>[]
          }
          create: {
            args: Prisma.ProviderConfigCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>
          }
          createMany: {
            args: Prisma.ProviderConfigCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ProviderConfigCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>[]
          }
          delete: {
            args: Prisma.ProviderConfigDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>
          }
          update: {
            args: Prisma.ProviderConfigUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>
          }
          deleteMany: {
            args: Prisma.ProviderConfigDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ProviderConfigUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.ProviderConfigUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ProviderConfigPayload>
          }
          aggregate: {
            args: Prisma.ProviderConfigAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateProviderConfig>
          }
          groupBy: {
            args: Prisma.ProviderConfigGroupByArgs<ExtArgs>
            result: $Utils.Optional<ProviderConfigGroupByOutputType>[]
          }
          count: {
            args: Prisma.ProviderConfigCountArgs<ExtArgs>
            result: $Utils.Optional<ProviderConfigCountAggregateOutputType> | number
          }
        }
      }
      SkillArtifact: {
        payload: Prisma.$SkillArtifactPayload<ExtArgs>
        fields: Prisma.SkillArtifactFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SkillArtifactFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SkillArtifactFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>
          }
          findFirst: {
            args: Prisma.SkillArtifactFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SkillArtifactFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>
          }
          findMany: {
            args: Prisma.SkillArtifactFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>[]
          }
          create: {
            args: Prisma.SkillArtifactCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>
          }
          createMany: {
            args: Prisma.SkillArtifactCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SkillArtifactCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>[]
          }
          delete: {
            args: Prisma.SkillArtifactDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>
          }
          update: {
            args: Prisma.SkillArtifactUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>
          }
          deleteMany: {
            args: Prisma.SkillArtifactDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SkillArtifactUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.SkillArtifactUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SkillArtifactPayload>
          }
          aggregate: {
            args: Prisma.SkillArtifactAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSkillArtifact>
          }
          groupBy: {
            args: Prisma.SkillArtifactGroupByArgs<ExtArgs>
            result: $Utils.Optional<SkillArtifactGroupByOutputType>[]
          }
          count: {
            args: Prisma.SkillArtifactCountArgs<ExtArgs>
            result: $Utils.Optional<SkillArtifactCountAggregateOutputType> | number
          }
        }
      }
      PromptVersion: {
        payload: Prisma.$PromptVersionPayload<ExtArgs>
        fields: Prisma.PromptVersionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PromptVersionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PromptVersionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>
          }
          findFirst: {
            args: Prisma.PromptVersionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PromptVersionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>
          }
          findMany: {
            args: Prisma.PromptVersionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>[]
          }
          create: {
            args: Prisma.PromptVersionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>
          }
          createMany: {
            args: Prisma.PromptVersionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PromptVersionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>[]
          }
          delete: {
            args: Prisma.PromptVersionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>
          }
          update: {
            args: Prisma.PromptVersionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>
          }
          deleteMany: {
            args: Prisma.PromptVersionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PromptVersionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.PromptVersionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PromptVersionPayload>
          }
          aggregate: {
            args: Prisma.PromptVersionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePromptVersion>
          }
          groupBy: {
            args: Prisma.PromptVersionGroupByArgs<ExtArgs>
            result: $Utils.Optional<PromptVersionGroupByOutputType>[]
          }
          count: {
            args: Prisma.PromptVersionCountArgs<ExtArgs>
            result: $Utils.Optional<PromptVersionCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Instance of a Driver Adapter, e.g., like one provided by `@prisma/adapter-planetscale`
     */
    adapter?: runtime.DriverAdapter | null
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type ProjectCountOutputType
   */

  export type ProjectCountOutputType = {
    tasks: number
  }

  export type ProjectCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tasks?: boolean | ProjectCountOutputTypeCountTasksArgs
  }

  // Custom InputTypes
  /**
   * ProjectCountOutputType without action
   */
  export type ProjectCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectCountOutputType
     */
    select?: ProjectCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * ProjectCountOutputType without action
   */
  export type ProjectCountOutputTypeCountTasksArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskWhereInput
  }


  /**
   * Count Type TaskCountOutputType
   */

  export type TaskCountOutputType = {
    steps: number
    traces: number
    diffs: number
    agentRuns: number
    traceSpans: number
  }

  export type TaskCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    steps?: boolean | TaskCountOutputTypeCountStepsArgs
    traces?: boolean | TaskCountOutputTypeCountTracesArgs
    diffs?: boolean | TaskCountOutputTypeCountDiffsArgs
    agentRuns?: boolean | TaskCountOutputTypeCountAgentRunsArgs
    traceSpans?: boolean | TaskCountOutputTypeCountTraceSpansArgs
  }

  // Custom InputTypes
  /**
   * TaskCountOutputType without action
   */
  export type TaskCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskCountOutputType
     */
    select?: TaskCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TaskCountOutputType without action
   */
  export type TaskCountOutputTypeCountStepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskStepWhereInput
  }

  /**
   * TaskCountOutputType without action
   */
  export type TaskCountOutputTypeCountTracesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskTraceWhereInput
  }

  /**
   * TaskCountOutputType without action
   */
  export type TaskCountOutputTypeCountDiffsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskDiffWhereInput
  }

  /**
   * TaskCountOutputType without action
   */
  export type TaskCountOutputTypeCountAgentRunsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunWhereInput
  }

  /**
   * TaskCountOutputType without action
   */
  export type TaskCountOutputTypeCountTraceSpansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TraceSpanWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Project
   */

  export type AggregateProject = {
    _count: ProjectCountAggregateOutputType | null
    _min: ProjectMinAggregateOutputType | null
    _max: ProjectMaxAggregateOutputType | null
  }

  export type ProjectMinAggregateOutputType = {
    id: string | null
    name: string | null
    path: string | null
    repoUrl: string | null
    description: string | null
    env: string | null
    createdAt: Date | null
  }

  export type ProjectMaxAggregateOutputType = {
    id: string | null
    name: string | null
    path: string | null
    repoUrl: string | null
    description: string | null
    env: string | null
    createdAt: Date | null
  }

  export type ProjectCountAggregateOutputType = {
    id: number
    name: number
    path: number
    repoUrl: number
    description: number
    env: number
    createdAt: number
    _all: number
  }


  export type ProjectMinAggregateInputType = {
    id?: true
    name?: true
    path?: true
    repoUrl?: true
    description?: true
    env?: true
    createdAt?: true
  }

  export type ProjectMaxAggregateInputType = {
    id?: true
    name?: true
    path?: true
    repoUrl?: true
    description?: true
    env?: true
    createdAt?: true
  }

  export type ProjectCountAggregateInputType = {
    id?: true
    name?: true
    path?: true
    repoUrl?: true
    description?: true
    env?: true
    createdAt?: true
    _all?: true
  }

  export type ProjectAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Project to aggregate.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Projects
    **/
    _count?: true | ProjectCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ProjectMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ProjectMaxAggregateInputType
  }

  export type GetProjectAggregateType<T extends ProjectAggregateArgs> = {
        [P in keyof T & keyof AggregateProject]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateProject[P]>
      : GetScalarType<T[P], AggregateProject[P]>
  }




  export type ProjectGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectWhereInput
    orderBy?: ProjectOrderByWithAggregationInput | ProjectOrderByWithAggregationInput[]
    by: ProjectScalarFieldEnum[] | ProjectScalarFieldEnum
    having?: ProjectScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ProjectCountAggregateInputType | true
    _min?: ProjectMinAggregateInputType
    _max?: ProjectMaxAggregateInputType
  }

  export type ProjectGroupByOutputType = {
    id: string
    name: string
    path: string
    repoUrl: string | null
    description: string | null
    env: string | null
    createdAt: Date
    _count: ProjectCountAggregateOutputType | null
    _min: ProjectMinAggregateOutputType | null
    _max: ProjectMaxAggregateOutputType | null
  }

  type GetProjectGroupByPayload<T extends ProjectGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ProjectGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ProjectGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ProjectGroupByOutputType[P]>
            : GetScalarType<T[P], ProjectGroupByOutputType[P]>
        }
      >
    >


  export type ProjectSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    path?: boolean
    repoUrl?: boolean
    description?: boolean
    env?: boolean
    createdAt?: boolean
    tasks?: boolean | Project$tasksArgs<ExtArgs>
    _count?: boolean | ProjectCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["project"]>

  export type ProjectSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    path?: boolean
    repoUrl?: boolean
    description?: boolean
    env?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["project"]>

  export type ProjectSelectScalar = {
    id?: boolean
    name?: boolean
    path?: boolean
    repoUrl?: boolean
    description?: boolean
    env?: boolean
    createdAt?: boolean
  }

  export type ProjectInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tasks?: boolean | Project$tasksArgs<ExtArgs>
    _count?: boolean | ProjectCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type ProjectIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $ProjectPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Project"
    objects: {
      tasks: Prisma.$TaskPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      path: string
      repoUrl: string | null
      description: string | null
      env: string | null
      createdAt: Date
    }, ExtArgs["result"]["project"]>
    composites: {}
  }

  type ProjectGetPayload<S extends boolean | null | undefined | ProjectDefaultArgs> = $Result.GetResult<Prisma.$ProjectPayload, S>

  type ProjectCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ProjectFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ProjectCountAggregateInputType | true
    }

  export interface ProjectDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Project'], meta: { name: 'Project' } }
    /**
     * Find zero or one Project that matches the filter.
     * @param {ProjectFindUniqueArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ProjectFindUniqueArgs>(args: SelectSubset<T, ProjectFindUniqueArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Project that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ProjectFindUniqueOrThrowArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ProjectFindUniqueOrThrowArgs>(args: SelectSubset<T, ProjectFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Project that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectFindFirstArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ProjectFindFirstArgs>(args?: SelectSubset<T, ProjectFindFirstArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Project that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectFindFirstOrThrowArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ProjectFindFirstOrThrowArgs>(args?: SelectSubset<T, ProjectFindFirstOrThrowArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Projects that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Projects
     * const projects = await prisma.project.findMany()
     * 
     * // Get first 10 Projects
     * const projects = await prisma.project.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const projectWithIdOnly = await prisma.project.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ProjectFindManyArgs>(args?: SelectSubset<T, ProjectFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Project.
     * @param {ProjectCreateArgs} args - Arguments to create a Project.
     * @example
     * // Create one Project
     * const Project = await prisma.project.create({
     *   data: {
     *     // ... data to create a Project
     *   }
     * })
     * 
     */
    create<T extends ProjectCreateArgs>(args: SelectSubset<T, ProjectCreateArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Projects.
     * @param {ProjectCreateManyArgs} args - Arguments to create many Projects.
     * @example
     * // Create many Projects
     * const project = await prisma.project.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ProjectCreateManyArgs>(args?: SelectSubset<T, ProjectCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Projects and returns the data saved in the database.
     * @param {ProjectCreateManyAndReturnArgs} args - Arguments to create many Projects.
     * @example
     * // Create many Projects
     * const project = await prisma.project.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Projects and only return the `id`
     * const projectWithIdOnly = await prisma.project.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ProjectCreateManyAndReturnArgs>(args?: SelectSubset<T, ProjectCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Project.
     * @param {ProjectDeleteArgs} args - Arguments to delete one Project.
     * @example
     * // Delete one Project
     * const Project = await prisma.project.delete({
     *   where: {
     *     // ... filter to delete one Project
     *   }
     * })
     * 
     */
    delete<T extends ProjectDeleteArgs>(args: SelectSubset<T, ProjectDeleteArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Project.
     * @param {ProjectUpdateArgs} args - Arguments to update one Project.
     * @example
     * // Update one Project
     * const project = await prisma.project.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ProjectUpdateArgs>(args: SelectSubset<T, ProjectUpdateArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Projects.
     * @param {ProjectDeleteManyArgs} args - Arguments to filter Projects to delete.
     * @example
     * // Delete a few Projects
     * const { count } = await prisma.project.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ProjectDeleteManyArgs>(args?: SelectSubset<T, ProjectDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Projects.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Projects
     * const project = await prisma.project.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ProjectUpdateManyArgs>(args: SelectSubset<T, ProjectUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Project.
     * @param {ProjectUpsertArgs} args - Arguments to update or create a Project.
     * @example
     * // Update or create a Project
     * const project = await prisma.project.upsert({
     *   create: {
     *     // ... data to create a Project
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Project we want to update
     *   }
     * })
     */
    upsert<T extends ProjectUpsertArgs>(args: SelectSubset<T, ProjectUpsertArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Projects.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCountArgs} args - Arguments to filter Projects to count.
     * @example
     * // Count the number of Projects
     * const count = await prisma.project.count({
     *   where: {
     *     // ... the filter for the Projects we want to count
     *   }
     * })
    **/
    count<T extends ProjectCountArgs>(
      args?: Subset<T, ProjectCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ProjectCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Project.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ProjectAggregateArgs>(args: Subset<T, ProjectAggregateArgs>): Prisma.PrismaPromise<GetProjectAggregateType<T>>

    /**
     * Group by Project.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ProjectGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ProjectGroupByArgs['orderBy'] }
        : { orderBy?: ProjectGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ProjectGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProjectGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Project model
   */
  readonly fields: ProjectFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Project.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ProjectClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tasks<T extends Project$tasksArgs<ExtArgs> = {}>(args?: Subset<T, Project$tasksArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Project model
   */ 
  interface ProjectFieldRefs {
    readonly id: FieldRef<"Project", 'String'>
    readonly name: FieldRef<"Project", 'String'>
    readonly path: FieldRef<"Project", 'String'>
    readonly repoUrl: FieldRef<"Project", 'String'>
    readonly description: FieldRef<"Project", 'String'>
    readonly env: FieldRef<"Project", 'String'>
    readonly createdAt: FieldRef<"Project", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Project findUnique
   */
  export type ProjectFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where: ProjectWhereUniqueInput
  }

  /**
   * Project findUniqueOrThrow
   */
  export type ProjectFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where: ProjectWhereUniqueInput
  }

  /**
   * Project findFirst
   */
  export type ProjectFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Projects.
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Projects.
     */
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }

  /**
   * Project findFirstOrThrow
   */
  export type ProjectFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Projects.
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Projects.
     */
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }

  /**
   * Project findMany
   */
  export type ProjectFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Projects to fetch.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Projects.
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }

  /**
   * Project create
   */
  export type ProjectCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * The data needed to create a Project.
     */
    data: XOR<ProjectCreateInput, ProjectUncheckedCreateInput>
  }

  /**
   * Project createMany
   */
  export type ProjectCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Projects.
     */
    data: ProjectCreateManyInput | ProjectCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Project createManyAndReturn
   */
  export type ProjectCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Projects.
     */
    data: ProjectCreateManyInput | ProjectCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Project update
   */
  export type ProjectUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * The data needed to update a Project.
     */
    data: XOR<ProjectUpdateInput, ProjectUncheckedUpdateInput>
    /**
     * Choose, which Project to update.
     */
    where: ProjectWhereUniqueInput
  }

  /**
   * Project updateMany
   */
  export type ProjectUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Projects.
     */
    data: XOR<ProjectUpdateManyMutationInput, ProjectUncheckedUpdateManyInput>
    /**
     * Filter which Projects to update
     */
    where?: ProjectWhereInput
  }

  /**
   * Project upsert
   */
  export type ProjectUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * The filter to search for the Project to update in case it exists.
     */
    where: ProjectWhereUniqueInput
    /**
     * In case the Project found by the `where` argument doesn't exist, create a new Project with this data.
     */
    create: XOR<ProjectCreateInput, ProjectUncheckedCreateInput>
    /**
     * In case the Project was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ProjectUpdateInput, ProjectUncheckedUpdateInput>
  }

  /**
   * Project delete
   */
  export type ProjectDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter which Project to delete.
     */
    where: ProjectWhereUniqueInput
  }

  /**
   * Project deleteMany
   */
  export type ProjectDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Projects to delete
     */
    where?: ProjectWhereInput
  }

  /**
   * Project.tasks
   */
  export type Project$tasksArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    where?: TaskWhereInput
    orderBy?: TaskOrderByWithRelationInput | TaskOrderByWithRelationInput[]
    cursor?: TaskWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TaskScalarFieldEnum | TaskScalarFieldEnum[]
  }

  /**
   * Project without action
   */
  export type ProjectDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ProjectInclude<ExtArgs> | null
  }


  /**
   * Model Task
   */

  export type AggregateTask = {
    _count: TaskCountAggregateOutputType | null
    _min: TaskMinAggregateOutputType | null
    _max: TaskMaxAggregateOutputType | null
  }

  export type TaskMinAggregateOutputType = {
    id: string | null
    projectId: string | null
    title: string | null
    description: string | null
    status: string | null
    complexity: string | null
    tags: string | null
    provider: string | null
    model: string | null
    result: string | null
    error: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TaskMaxAggregateOutputType = {
    id: string | null
    projectId: string | null
    title: string | null
    description: string | null
    status: string | null
    complexity: string | null
    tags: string | null
    provider: string | null
    model: string | null
    result: string | null
    error: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TaskCountAggregateOutputType = {
    id: number
    projectId: number
    title: number
    description: number
    status: number
    complexity: number
    tags: number
    provider: number
    model: number
    result: number
    error: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TaskMinAggregateInputType = {
    id?: true
    projectId?: true
    title?: true
    description?: true
    status?: true
    complexity?: true
    tags?: true
    provider?: true
    model?: true
    result?: true
    error?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TaskMaxAggregateInputType = {
    id?: true
    projectId?: true
    title?: true
    description?: true
    status?: true
    complexity?: true
    tags?: true
    provider?: true
    model?: true
    result?: true
    error?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TaskCountAggregateInputType = {
    id?: true
    projectId?: true
    title?: true
    description?: true
    status?: true
    complexity?: true
    tags?: true
    provider?: true
    model?: true
    result?: true
    error?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TaskAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Task to aggregate.
     */
    where?: TaskWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tasks to fetch.
     */
    orderBy?: TaskOrderByWithRelationInput | TaskOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TaskWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tasks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tasks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Tasks
    **/
    _count?: true | TaskCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TaskMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TaskMaxAggregateInputType
  }

  export type GetTaskAggregateType<T extends TaskAggregateArgs> = {
        [P in keyof T & keyof AggregateTask]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTask[P]>
      : GetScalarType<T[P], AggregateTask[P]>
  }




  export type TaskGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskWhereInput
    orderBy?: TaskOrderByWithAggregationInput | TaskOrderByWithAggregationInput[]
    by: TaskScalarFieldEnum[] | TaskScalarFieldEnum
    having?: TaskScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TaskCountAggregateInputType | true
    _min?: TaskMinAggregateInputType
    _max?: TaskMaxAggregateInputType
  }

  export type TaskGroupByOutputType = {
    id: string
    projectId: string
    title: string
    description: string | null
    status: string
    complexity: string
    tags: string | null
    provider: string | null
    model: string | null
    result: string | null
    error: string | null
    createdAt: Date
    updatedAt: Date
    _count: TaskCountAggregateOutputType | null
    _min: TaskMinAggregateOutputType | null
    _max: TaskMaxAggregateOutputType | null
  }

  type GetTaskGroupByPayload<T extends TaskGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TaskGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TaskGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TaskGroupByOutputType[P]>
            : GetScalarType<T[P], TaskGroupByOutputType[P]>
        }
      >
    >


  export type TaskSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    title?: boolean
    description?: boolean
    status?: boolean
    complexity?: boolean
    tags?: boolean
    provider?: boolean
    model?: boolean
    result?: boolean
    error?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    project?: boolean | ProjectDefaultArgs<ExtArgs>
    steps?: boolean | Task$stepsArgs<ExtArgs>
    traces?: boolean | Task$tracesArgs<ExtArgs>
    diffs?: boolean | Task$diffsArgs<ExtArgs>
    agentRuns?: boolean | Task$agentRunsArgs<ExtArgs>
    traceSpans?: boolean | Task$traceSpansArgs<ExtArgs>
    _count?: boolean | TaskCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["task"]>

  export type TaskSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    title?: boolean
    description?: boolean
    status?: boolean
    complexity?: boolean
    tags?: boolean
    provider?: boolean
    model?: boolean
    result?: boolean
    error?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    project?: boolean | ProjectDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["task"]>

  export type TaskSelectScalar = {
    id?: boolean
    projectId?: boolean
    title?: boolean
    description?: boolean
    status?: boolean
    complexity?: boolean
    tags?: boolean
    provider?: boolean
    model?: boolean
    result?: boolean
    error?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TaskInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    project?: boolean | ProjectDefaultArgs<ExtArgs>
    steps?: boolean | Task$stepsArgs<ExtArgs>
    traces?: boolean | Task$tracesArgs<ExtArgs>
    diffs?: boolean | Task$diffsArgs<ExtArgs>
    agentRuns?: boolean | Task$agentRunsArgs<ExtArgs>
    traceSpans?: boolean | Task$traceSpansArgs<ExtArgs>
    _count?: boolean | TaskCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TaskIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    project?: boolean | ProjectDefaultArgs<ExtArgs>
  }

  export type $TaskPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Task"
    objects: {
      project: Prisma.$ProjectPayload<ExtArgs>
      steps: Prisma.$TaskStepPayload<ExtArgs>[]
      traces: Prisma.$TaskTracePayload<ExtArgs>[]
      diffs: Prisma.$TaskDiffPayload<ExtArgs>[]
      agentRuns: Prisma.$AgentRunPayload<ExtArgs>[]
      traceSpans: Prisma.$TraceSpanPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectId: string
      title: string
      description: string | null
      status: string
      complexity: string
      tags: string | null
      provider: string | null
      model: string | null
      result: string | null
      error: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["task"]>
    composites: {}
  }

  type TaskGetPayload<S extends boolean | null | undefined | TaskDefaultArgs> = $Result.GetResult<Prisma.$TaskPayload, S>

  type TaskCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TaskFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TaskCountAggregateInputType | true
    }

  export interface TaskDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Task'], meta: { name: 'Task' } }
    /**
     * Find zero or one Task that matches the filter.
     * @param {TaskFindUniqueArgs} args - Arguments to find a Task
     * @example
     * // Get one Task
     * const task = await prisma.task.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TaskFindUniqueArgs>(args: SelectSubset<T, TaskFindUniqueArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Task that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TaskFindUniqueOrThrowArgs} args - Arguments to find a Task
     * @example
     * // Get one Task
     * const task = await prisma.task.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TaskFindUniqueOrThrowArgs>(args: SelectSubset<T, TaskFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Task that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskFindFirstArgs} args - Arguments to find a Task
     * @example
     * // Get one Task
     * const task = await prisma.task.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TaskFindFirstArgs>(args?: SelectSubset<T, TaskFindFirstArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Task that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskFindFirstOrThrowArgs} args - Arguments to find a Task
     * @example
     * // Get one Task
     * const task = await prisma.task.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TaskFindFirstOrThrowArgs>(args?: SelectSubset<T, TaskFindFirstOrThrowArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Tasks that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Tasks
     * const tasks = await prisma.task.findMany()
     * 
     * // Get first 10 Tasks
     * const tasks = await prisma.task.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const taskWithIdOnly = await prisma.task.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TaskFindManyArgs>(args?: SelectSubset<T, TaskFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Task.
     * @param {TaskCreateArgs} args - Arguments to create a Task.
     * @example
     * // Create one Task
     * const Task = await prisma.task.create({
     *   data: {
     *     // ... data to create a Task
     *   }
     * })
     * 
     */
    create<T extends TaskCreateArgs>(args: SelectSubset<T, TaskCreateArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Tasks.
     * @param {TaskCreateManyArgs} args - Arguments to create many Tasks.
     * @example
     * // Create many Tasks
     * const task = await prisma.task.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TaskCreateManyArgs>(args?: SelectSubset<T, TaskCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Tasks and returns the data saved in the database.
     * @param {TaskCreateManyAndReturnArgs} args - Arguments to create many Tasks.
     * @example
     * // Create many Tasks
     * const task = await prisma.task.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Tasks and only return the `id`
     * const taskWithIdOnly = await prisma.task.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TaskCreateManyAndReturnArgs>(args?: SelectSubset<T, TaskCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Task.
     * @param {TaskDeleteArgs} args - Arguments to delete one Task.
     * @example
     * // Delete one Task
     * const Task = await prisma.task.delete({
     *   where: {
     *     // ... filter to delete one Task
     *   }
     * })
     * 
     */
    delete<T extends TaskDeleteArgs>(args: SelectSubset<T, TaskDeleteArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Task.
     * @param {TaskUpdateArgs} args - Arguments to update one Task.
     * @example
     * // Update one Task
     * const task = await prisma.task.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TaskUpdateArgs>(args: SelectSubset<T, TaskUpdateArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Tasks.
     * @param {TaskDeleteManyArgs} args - Arguments to filter Tasks to delete.
     * @example
     * // Delete a few Tasks
     * const { count } = await prisma.task.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TaskDeleteManyArgs>(args?: SelectSubset<T, TaskDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Tasks.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Tasks
     * const task = await prisma.task.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TaskUpdateManyArgs>(args: SelectSubset<T, TaskUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Task.
     * @param {TaskUpsertArgs} args - Arguments to update or create a Task.
     * @example
     * // Update or create a Task
     * const task = await prisma.task.upsert({
     *   create: {
     *     // ... data to create a Task
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Task we want to update
     *   }
     * })
     */
    upsert<T extends TaskUpsertArgs>(args: SelectSubset<T, TaskUpsertArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Tasks.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskCountArgs} args - Arguments to filter Tasks to count.
     * @example
     * // Count the number of Tasks
     * const count = await prisma.task.count({
     *   where: {
     *     // ... the filter for the Tasks we want to count
     *   }
     * })
    **/
    count<T extends TaskCountArgs>(
      args?: Subset<T, TaskCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TaskCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Task.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TaskAggregateArgs>(args: Subset<T, TaskAggregateArgs>): Prisma.PrismaPromise<GetTaskAggregateType<T>>

    /**
     * Group by Task.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TaskGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TaskGroupByArgs['orderBy'] }
        : { orderBy?: TaskGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TaskGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTaskGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Task model
   */
  readonly fields: TaskFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Task.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TaskClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    project<T extends ProjectDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ProjectDefaultArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    steps<T extends Task$stepsArgs<ExtArgs> = {}>(args?: Subset<T, Task$stepsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "findMany"> | Null>
    traces<T extends Task$tracesArgs<ExtArgs> = {}>(args?: Subset<T, Task$tracesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "findMany"> | Null>
    diffs<T extends Task$diffsArgs<ExtArgs> = {}>(args?: Subset<T, Task$diffsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "findMany"> | Null>
    agentRuns<T extends Task$agentRunsArgs<ExtArgs> = {}>(args?: Subset<T, Task$agentRunsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findMany"> | Null>
    traceSpans<T extends Task$traceSpansArgs<ExtArgs> = {}>(args?: Subset<T, Task$traceSpansArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Task model
   */ 
  interface TaskFieldRefs {
    readonly id: FieldRef<"Task", 'String'>
    readonly projectId: FieldRef<"Task", 'String'>
    readonly title: FieldRef<"Task", 'String'>
    readonly description: FieldRef<"Task", 'String'>
    readonly status: FieldRef<"Task", 'String'>
    readonly complexity: FieldRef<"Task", 'String'>
    readonly tags: FieldRef<"Task", 'String'>
    readonly provider: FieldRef<"Task", 'String'>
    readonly model: FieldRef<"Task", 'String'>
    readonly result: FieldRef<"Task", 'String'>
    readonly error: FieldRef<"Task", 'String'>
    readonly createdAt: FieldRef<"Task", 'DateTime'>
    readonly updatedAt: FieldRef<"Task", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Task findUnique
   */
  export type TaskFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * Filter, which Task to fetch.
     */
    where: TaskWhereUniqueInput
  }

  /**
   * Task findUniqueOrThrow
   */
  export type TaskFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * Filter, which Task to fetch.
     */
    where: TaskWhereUniqueInput
  }

  /**
   * Task findFirst
   */
  export type TaskFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * Filter, which Task to fetch.
     */
    where?: TaskWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tasks to fetch.
     */
    orderBy?: TaskOrderByWithRelationInput | TaskOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tasks.
     */
    cursor?: TaskWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tasks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tasks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tasks.
     */
    distinct?: TaskScalarFieldEnum | TaskScalarFieldEnum[]
  }

  /**
   * Task findFirstOrThrow
   */
  export type TaskFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * Filter, which Task to fetch.
     */
    where?: TaskWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tasks to fetch.
     */
    orderBy?: TaskOrderByWithRelationInput | TaskOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tasks.
     */
    cursor?: TaskWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tasks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tasks.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tasks.
     */
    distinct?: TaskScalarFieldEnum | TaskScalarFieldEnum[]
  }

  /**
   * Task findMany
   */
  export type TaskFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * Filter, which Tasks to fetch.
     */
    where?: TaskWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tasks to fetch.
     */
    orderBy?: TaskOrderByWithRelationInput | TaskOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Tasks.
     */
    cursor?: TaskWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tasks from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tasks.
     */
    skip?: number
    distinct?: TaskScalarFieldEnum | TaskScalarFieldEnum[]
  }

  /**
   * Task create
   */
  export type TaskCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * The data needed to create a Task.
     */
    data: XOR<TaskCreateInput, TaskUncheckedCreateInput>
  }

  /**
   * Task createMany
   */
  export type TaskCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Tasks.
     */
    data: TaskCreateManyInput | TaskCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Task createManyAndReturn
   */
  export type TaskCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Tasks.
     */
    data: TaskCreateManyInput | TaskCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Task update
   */
  export type TaskUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * The data needed to update a Task.
     */
    data: XOR<TaskUpdateInput, TaskUncheckedUpdateInput>
    /**
     * Choose, which Task to update.
     */
    where: TaskWhereUniqueInput
  }

  /**
   * Task updateMany
   */
  export type TaskUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Tasks.
     */
    data: XOR<TaskUpdateManyMutationInput, TaskUncheckedUpdateManyInput>
    /**
     * Filter which Tasks to update
     */
    where?: TaskWhereInput
  }

  /**
   * Task upsert
   */
  export type TaskUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * The filter to search for the Task to update in case it exists.
     */
    where: TaskWhereUniqueInput
    /**
     * In case the Task found by the `where` argument doesn't exist, create a new Task with this data.
     */
    create: XOR<TaskCreateInput, TaskUncheckedCreateInput>
    /**
     * In case the Task was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TaskUpdateInput, TaskUncheckedUpdateInput>
  }

  /**
   * Task delete
   */
  export type TaskDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    /**
     * Filter which Task to delete.
     */
    where: TaskWhereUniqueInput
  }

  /**
   * Task deleteMany
   */
  export type TaskDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tasks to delete
     */
    where?: TaskWhereInput
  }

  /**
   * Task.steps
   */
  export type Task$stepsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    where?: TaskStepWhereInput
    orderBy?: TaskStepOrderByWithRelationInput | TaskStepOrderByWithRelationInput[]
    cursor?: TaskStepWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TaskStepScalarFieldEnum | TaskStepScalarFieldEnum[]
  }

  /**
   * Task.traces
   */
  export type Task$tracesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    where?: TaskTraceWhereInput
    orderBy?: TaskTraceOrderByWithRelationInput | TaskTraceOrderByWithRelationInput[]
    cursor?: TaskTraceWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TaskTraceScalarFieldEnum | TaskTraceScalarFieldEnum[]
  }

  /**
   * Task.diffs
   */
  export type Task$diffsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    where?: TaskDiffWhereInput
    orderBy?: TaskDiffOrderByWithRelationInput | TaskDiffOrderByWithRelationInput[]
    cursor?: TaskDiffWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TaskDiffScalarFieldEnum | TaskDiffScalarFieldEnum[]
  }

  /**
   * Task.agentRuns
   */
  export type Task$agentRunsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    where?: AgentRunWhereInput
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    cursor?: AgentRunWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * Task.traceSpans
   */
  export type Task$traceSpansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    where?: TraceSpanWhereInput
    orderBy?: TraceSpanOrderByWithRelationInput | TraceSpanOrderByWithRelationInput[]
    cursor?: TraceSpanWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TraceSpanScalarFieldEnum | TraceSpanScalarFieldEnum[]
  }

  /**
   * Task without action
   */
  export type TaskDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
  }


  /**
   * Model TaskStep
   */

  export type AggregateTaskStep = {
    _count: TaskStepCountAggregateOutputType | null
    _avg: TaskStepAvgAggregateOutputType | null
    _sum: TaskStepSumAggregateOutputType | null
    _min: TaskStepMinAggregateOutputType | null
    _max: TaskStepMaxAggregateOutputType | null
  }

  export type TaskStepAvgAggregateOutputType = {
    idx: number | null
  }

  export type TaskStepSumAggregateOutputType = {
    idx: number | null
  }

  export type TaskStepMinAggregateOutputType = {
    id: string | null
    taskId: string | null
    idx: number | null
    name: string | null
    status: string | null
    input: string | null
    output: string | null
    error: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TaskStepMaxAggregateOutputType = {
    id: string | null
    taskId: string | null
    idx: number | null
    name: string | null
    status: string | null
    input: string | null
    output: string | null
    error: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TaskStepCountAggregateOutputType = {
    id: number
    taskId: number
    idx: number
    name: number
    status: number
    input: number
    output: number
    error: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TaskStepAvgAggregateInputType = {
    idx?: true
  }

  export type TaskStepSumAggregateInputType = {
    idx?: true
  }

  export type TaskStepMinAggregateInputType = {
    id?: true
    taskId?: true
    idx?: true
    name?: true
    status?: true
    input?: true
    output?: true
    error?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TaskStepMaxAggregateInputType = {
    id?: true
    taskId?: true
    idx?: true
    name?: true
    status?: true
    input?: true
    output?: true
    error?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TaskStepCountAggregateInputType = {
    id?: true
    taskId?: true
    idx?: true
    name?: true
    status?: true
    input?: true
    output?: true
    error?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TaskStepAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TaskStep to aggregate.
     */
    where?: TaskStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskSteps to fetch.
     */
    orderBy?: TaskStepOrderByWithRelationInput | TaskStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TaskStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TaskSteps
    **/
    _count?: true | TaskStepCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TaskStepAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TaskStepSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TaskStepMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TaskStepMaxAggregateInputType
  }

  export type GetTaskStepAggregateType<T extends TaskStepAggregateArgs> = {
        [P in keyof T & keyof AggregateTaskStep]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTaskStep[P]>
      : GetScalarType<T[P], AggregateTaskStep[P]>
  }




  export type TaskStepGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskStepWhereInput
    orderBy?: TaskStepOrderByWithAggregationInput | TaskStepOrderByWithAggregationInput[]
    by: TaskStepScalarFieldEnum[] | TaskStepScalarFieldEnum
    having?: TaskStepScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TaskStepCountAggregateInputType | true
    _avg?: TaskStepAvgAggregateInputType
    _sum?: TaskStepSumAggregateInputType
    _min?: TaskStepMinAggregateInputType
    _max?: TaskStepMaxAggregateInputType
  }

  export type TaskStepGroupByOutputType = {
    id: string
    taskId: string
    idx: number
    name: string
    status: string
    input: string | null
    output: string | null
    error: string | null
    createdAt: Date
    updatedAt: Date
    _count: TaskStepCountAggregateOutputType | null
    _avg: TaskStepAvgAggregateOutputType | null
    _sum: TaskStepSumAggregateOutputType | null
    _min: TaskStepMinAggregateOutputType | null
    _max: TaskStepMaxAggregateOutputType | null
  }

  type GetTaskStepGroupByPayload<T extends TaskStepGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TaskStepGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TaskStepGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TaskStepGroupByOutputType[P]>
            : GetScalarType<T[P], TaskStepGroupByOutputType[P]>
        }
      >
    >


  export type TaskStepSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    idx?: boolean
    name?: boolean
    status?: boolean
    input?: boolean
    output?: boolean
    error?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["taskStep"]>

  export type TaskStepSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    idx?: boolean
    name?: boolean
    status?: boolean
    input?: boolean
    output?: boolean
    error?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["taskStep"]>

  export type TaskStepSelectScalar = {
    id?: boolean
    taskId?: boolean
    idx?: boolean
    name?: boolean
    status?: boolean
    input?: boolean
    output?: boolean
    error?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TaskStepInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }
  export type TaskStepIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }

  export type $TaskStepPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TaskStep"
    objects: {
      task: Prisma.$TaskPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      taskId: string
      idx: number
      name: string
      status: string
      input: string | null
      output: string | null
      error: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["taskStep"]>
    composites: {}
  }

  type TaskStepGetPayload<S extends boolean | null | undefined | TaskStepDefaultArgs> = $Result.GetResult<Prisma.$TaskStepPayload, S>

  type TaskStepCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TaskStepFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TaskStepCountAggregateInputType | true
    }

  export interface TaskStepDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TaskStep'], meta: { name: 'TaskStep' } }
    /**
     * Find zero or one TaskStep that matches the filter.
     * @param {TaskStepFindUniqueArgs} args - Arguments to find a TaskStep
     * @example
     * // Get one TaskStep
     * const taskStep = await prisma.taskStep.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TaskStepFindUniqueArgs>(args: SelectSubset<T, TaskStepFindUniqueArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TaskStep that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TaskStepFindUniqueOrThrowArgs} args - Arguments to find a TaskStep
     * @example
     * // Get one TaskStep
     * const taskStep = await prisma.taskStep.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TaskStepFindUniqueOrThrowArgs>(args: SelectSubset<T, TaskStepFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TaskStep that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepFindFirstArgs} args - Arguments to find a TaskStep
     * @example
     * // Get one TaskStep
     * const taskStep = await prisma.taskStep.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TaskStepFindFirstArgs>(args?: SelectSubset<T, TaskStepFindFirstArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TaskStep that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepFindFirstOrThrowArgs} args - Arguments to find a TaskStep
     * @example
     * // Get one TaskStep
     * const taskStep = await prisma.taskStep.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TaskStepFindFirstOrThrowArgs>(args?: SelectSubset<T, TaskStepFindFirstOrThrowArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TaskSteps that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TaskSteps
     * const taskSteps = await prisma.taskStep.findMany()
     * 
     * // Get first 10 TaskSteps
     * const taskSteps = await prisma.taskStep.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const taskStepWithIdOnly = await prisma.taskStep.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TaskStepFindManyArgs>(args?: SelectSubset<T, TaskStepFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TaskStep.
     * @param {TaskStepCreateArgs} args - Arguments to create a TaskStep.
     * @example
     * // Create one TaskStep
     * const TaskStep = await prisma.taskStep.create({
     *   data: {
     *     // ... data to create a TaskStep
     *   }
     * })
     * 
     */
    create<T extends TaskStepCreateArgs>(args: SelectSubset<T, TaskStepCreateArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TaskSteps.
     * @param {TaskStepCreateManyArgs} args - Arguments to create many TaskSteps.
     * @example
     * // Create many TaskSteps
     * const taskStep = await prisma.taskStep.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TaskStepCreateManyArgs>(args?: SelectSubset<T, TaskStepCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TaskSteps and returns the data saved in the database.
     * @param {TaskStepCreateManyAndReturnArgs} args - Arguments to create many TaskSteps.
     * @example
     * // Create many TaskSteps
     * const taskStep = await prisma.taskStep.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TaskSteps and only return the `id`
     * const taskStepWithIdOnly = await prisma.taskStep.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TaskStepCreateManyAndReturnArgs>(args?: SelectSubset<T, TaskStepCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TaskStep.
     * @param {TaskStepDeleteArgs} args - Arguments to delete one TaskStep.
     * @example
     * // Delete one TaskStep
     * const TaskStep = await prisma.taskStep.delete({
     *   where: {
     *     // ... filter to delete one TaskStep
     *   }
     * })
     * 
     */
    delete<T extends TaskStepDeleteArgs>(args: SelectSubset<T, TaskStepDeleteArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TaskStep.
     * @param {TaskStepUpdateArgs} args - Arguments to update one TaskStep.
     * @example
     * // Update one TaskStep
     * const taskStep = await prisma.taskStep.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TaskStepUpdateArgs>(args: SelectSubset<T, TaskStepUpdateArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TaskSteps.
     * @param {TaskStepDeleteManyArgs} args - Arguments to filter TaskSteps to delete.
     * @example
     * // Delete a few TaskSteps
     * const { count } = await prisma.taskStep.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TaskStepDeleteManyArgs>(args?: SelectSubset<T, TaskStepDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TaskSteps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TaskSteps
     * const taskStep = await prisma.taskStep.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TaskStepUpdateManyArgs>(args: SelectSubset<T, TaskStepUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TaskStep.
     * @param {TaskStepUpsertArgs} args - Arguments to update or create a TaskStep.
     * @example
     * // Update or create a TaskStep
     * const taskStep = await prisma.taskStep.upsert({
     *   create: {
     *     // ... data to create a TaskStep
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TaskStep we want to update
     *   }
     * })
     */
    upsert<T extends TaskStepUpsertArgs>(args: SelectSubset<T, TaskStepUpsertArgs<ExtArgs>>): Prisma__TaskStepClient<$Result.GetResult<Prisma.$TaskStepPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TaskSteps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepCountArgs} args - Arguments to filter TaskSteps to count.
     * @example
     * // Count the number of TaskSteps
     * const count = await prisma.taskStep.count({
     *   where: {
     *     // ... the filter for the TaskSteps we want to count
     *   }
     * })
    **/
    count<T extends TaskStepCountArgs>(
      args?: Subset<T, TaskStepCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TaskStepCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TaskStep.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TaskStepAggregateArgs>(args: Subset<T, TaskStepAggregateArgs>): Prisma.PrismaPromise<GetTaskStepAggregateType<T>>

    /**
     * Group by TaskStep.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskStepGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TaskStepGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TaskStepGroupByArgs['orderBy'] }
        : { orderBy?: TaskStepGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TaskStepGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTaskStepGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TaskStep model
   */
  readonly fields: TaskStepFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TaskStep.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TaskStepClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    task<T extends TaskDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TaskDefaultArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the TaskStep model
   */ 
  interface TaskStepFieldRefs {
    readonly id: FieldRef<"TaskStep", 'String'>
    readonly taskId: FieldRef<"TaskStep", 'String'>
    readonly idx: FieldRef<"TaskStep", 'Int'>
    readonly name: FieldRef<"TaskStep", 'String'>
    readonly status: FieldRef<"TaskStep", 'String'>
    readonly input: FieldRef<"TaskStep", 'String'>
    readonly output: FieldRef<"TaskStep", 'String'>
    readonly error: FieldRef<"TaskStep", 'String'>
    readonly createdAt: FieldRef<"TaskStep", 'DateTime'>
    readonly updatedAt: FieldRef<"TaskStep", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TaskStep findUnique
   */
  export type TaskStepFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * Filter, which TaskStep to fetch.
     */
    where: TaskStepWhereUniqueInput
  }

  /**
   * TaskStep findUniqueOrThrow
   */
  export type TaskStepFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * Filter, which TaskStep to fetch.
     */
    where: TaskStepWhereUniqueInput
  }

  /**
   * TaskStep findFirst
   */
  export type TaskStepFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * Filter, which TaskStep to fetch.
     */
    where?: TaskStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskSteps to fetch.
     */
    orderBy?: TaskStepOrderByWithRelationInput | TaskStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TaskSteps.
     */
    cursor?: TaskStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TaskSteps.
     */
    distinct?: TaskStepScalarFieldEnum | TaskStepScalarFieldEnum[]
  }

  /**
   * TaskStep findFirstOrThrow
   */
  export type TaskStepFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * Filter, which TaskStep to fetch.
     */
    where?: TaskStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskSteps to fetch.
     */
    orderBy?: TaskStepOrderByWithRelationInput | TaskStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TaskSteps.
     */
    cursor?: TaskStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskSteps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TaskSteps.
     */
    distinct?: TaskStepScalarFieldEnum | TaskStepScalarFieldEnum[]
  }

  /**
   * TaskStep findMany
   */
  export type TaskStepFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * Filter, which TaskSteps to fetch.
     */
    where?: TaskStepWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskSteps to fetch.
     */
    orderBy?: TaskStepOrderByWithRelationInput | TaskStepOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TaskSteps.
     */
    cursor?: TaskStepWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskSteps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskSteps.
     */
    skip?: number
    distinct?: TaskStepScalarFieldEnum | TaskStepScalarFieldEnum[]
  }

  /**
   * TaskStep create
   */
  export type TaskStepCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * The data needed to create a TaskStep.
     */
    data: XOR<TaskStepCreateInput, TaskStepUncheckedCreateInput>
  }

  /**
   * TaskStep createMany
   */
  export type TaskStepCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TaskSteps.
     */
    data: TaskStepCreateManyInput | TaskStepCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TaskStep createManyAndReturn
   */
  export type TaskStepCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TaskSteps.
     */
    data: TaskStepCreateManyInput | TaskStepCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TaskStep update
   */
  export type TaskStepUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * The data needed to update a TaskStep.
     */
    data: XOR<TaskStepUpdateInput, TaskStepUncheckedUpdateInput>
    /**
     * Choose, which TaskStep to update.
     */
    where: TaskStepWhereUniqueInput
  }

  /**
   * TaskStep updateMany
   */
  export type TaskStepUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TaskSteps.
     */
    data: XOR<TaskStepUpdateManyMutationInput, TaskStepUncheckedUpdateManyInput>
    /**
     * Filter which TaskSteps to update
     */
    where?: TaskStepWhereInput
  }

  /**
   * TaskStep upsert
   */
  export type TaskStepUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * The filter to search for the TaskStep to update in case it exists.
     */
    where: TaskStepWhereUniqueInput
    /**
     * In case the TaskStep found by the `where` argument doesn't exist, create a new TaskStep with this data.
     */
    create: XOR<TaskStepCreateInput, TaskStepUncheckedCreateInput>
    /**
     * In case the TaskStep was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TaskStepUpdateInput, TaskStepUncheckedUpdateInput>
  }

  /**
   * TaskStep delete
   */
  export type TaskStepDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
    /**
     * Filter which TaskStep to delete.
     */
    where: TaskStepWhereUniqueInput
  }

  /**
   * TaskStep deleteMany
   */
  export type TaskStepDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TaskSteps to delete
     */
    where?: TaskStepWhereInput
  }

  /**
   * TaskStep without action
   */
  export type TaskStepDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskStep
     */
    select?: TaskStepSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskStepInclude<ExtArgs> | null
  }


  /**
   * Model TaskTrace
   */

  export type AggregateTaskTrace = {
    _count: TaskTraceCountAggregateOutputType | null
    _min: TaskTraceMinAggregateOutputType | null
    _max: TaskTraceMaxAggregateOutputType | null
  }

  export type TaskTraceMinAggregateOutputType = {
    id: string | null
    taskId: string | null
    stepId: string | null
    role: string | null
    content: string | null
    toolCalls: string | null
    createdAt: Date | null
  }

  export type TaskTraceMaxAggregateOutputType = {
    id: string | null
    taskId: string | null
    stepId: string | null
    role: string | null
    content: string | null
    toolCalls: string | null
    createdAt: Date | null
  }

  export type TaskTraceCountAggregateOutputType = {
    id: number
    taskId: number
    stepId: number
    role: number
    content: number
    toolCalls: number
    createdAt: number
    _all: number
  }


  export type TaskTraceMinAggregateInputType = {
    id?: true
    taskId?: true
    stepId?: true
    role?: true
    content?: true
    toolCalls?: true
    createdAt?: true
  }

  export type TaskTraceMaxAggregateInputType = {
    id?: true
    taskId?: true
    stepId?: true
    role?: true
    content?: true
    toolCalls?: true
    createdAt?: true
  }

  export type TaskTraceCountAggregateInputType = {
    id?: true
    taskId?: true
    stepId?: true
    role?: true
    content?: true
    toolCalls?: true
    createdAt?: true
    _all?: true
  }

  export type TaskTraceAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TaskTrace to aggregate.
     */
    where?: TaskTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskTraces to fetch.
     */
    orderBy?: TaskTraceOrderByWithRelationInput | TaskTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TaskTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskTraces.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TaskTraces
    **/
    _count?: true | TaskTraceCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TaskTraceMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TaskTraceMaxAggregateInputType
  }

  export type GetTaskTraceAggregateType<T extends TaskTraceAggregateArgs> = {
        [P in keyof T & keyof AggregateTaskTrace]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTaskTrace[P]>
      : GetScalarType<T[P], AggregateTaskTrace[P]>
  }




  export type TaskTraceGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskTraceWhereInput
    orderBy?: TaskTraceOrderByWithAggregationInput | TaskTraceOrderByWithAggregationInput[]
    by: TaskTraceScalarFieldEnum[] | TaskTraceScalarFieldEnum
    having?: TaskTraceScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TaskTraceCountAggregateInputType | true
    _min?: TaskTraceMinAggregateInputType
    _max?: TaskTraceMaxAggregateInputType
  }

  export type TaskTraceGroupByOutputType = {
    id: string
    taskId: string
    stepId: string | null
    role: string
    content: string | null
    toolCalls: string | null
    createdAt: Date
    _count: TaskTraceCountAggregateOutputType | null
    _min: TaskTraceMinAggregateOutputType | null
    _max: TaskTraceMaxAggregateOutputType | null
  }

  type GetTaskTraceGroupByPayload<T extends TaskTraceGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TaskTraceGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TaskTraceGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TaskTraceGroupByOutputType[P]>
            : GetScalarType<T[P], TaskTraceGroupByOutputType[P]>
        }
      >
    >


  export type TaskTraceSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    stepId?: boolean
    role?: boolean
    content?: boolean
    toolCalls?: boolean
    createdAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["taskTrace"]>

  export type TaskTraceSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    stepId?: boolean
    role?: boolean
    content?: boolean
    toolCalls?: boolean
    createdAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["taskTrace"]>

  export type TaskTraceSelectScalar = {
    id?: boolean
    taskId?: boolean
    stepId?: boolean
    role?: boolean
    content?: boolean
    toolCalls?: boolean
    createdAt?: boolean
  }

  export type TaskTraceInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }
  export type TaskTraceIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }

  export type $TaskTracePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TaskTrace"
    objects: {
      task: Prisma.$TaskPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      taskId: string
      stepId: string | null
      role: string
      content: string | null
      toolCalls: string | null
      createdAt: Date
    }, ExtArgs["result"]["taskTrace"]>
    composites: {}
  }

  type TaskTraceGetPayload<S extends boolean | null | undefined | TaskTraceDefaultArgs> = $Result.GetResult<Prisma.$TaskTracePayload, S>

  type TaskTraceCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TaskTraceFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TaskTraceCountAggregateInputType | true
    }

  export interface TaskTraceDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TaskTrace'], meta: { name: 'TaskTrace' } }
    /**
     * Find zero or one TaskTrace that matches the filter.
     * @param {TaskTraceFindUniqueArgs} args - Arguments to find a TaskTrace
     * @example
     * // Get one TaskTrace
     * const taskTrace = await prisma.taskTrace.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TaskTraceFindUniqueArgs>(args: SelectSubset<T, TaskTraceFindUniqueArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TaskTrace that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TaskTraceFindUniqueOrThrowArgs} args - Arguments to find a TaskTrace
     * @example
     * // Get one TaskTrace
     * const taskTrace = await prisma.taskTrace.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TaskTraceFindUniqueOrThrowArgs>(args: SelectSubset<T, TaskTraceFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TaskTrace that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceFindFirstArgs} args - Arguments to find a TaskTrace
     * @example
     * // Get one TaskTrace
     * const taskTrace = await prisma.taskTrace.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TaskTraceFindFirstArgs>(args?: SelectSubset<T, TaskTraceFindFirstArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TaskTrace that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceFindFirstOrThrowArgs} args - Arguments to find a TaskTrace
     * @example
     * // Get one TaskTrace
     * const taskTrace = await prisma.taskTrace.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TaskTraceFindFirstOrThrowArgs>(args?: SelectSubset<T, TaskTraceFindFirstOrThrowArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TaskTraces that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TaskTraces
     * const taskTraces = await prisma.taskTrace.findMany()
     * 
     * // Get first 10 TaskTraces
     * const taskTraces = await prisma.taskTrace.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const taskTraceWithIdOnly = await prisma.taskTrace.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TaskTraceFindManyArgs>(args?: SelectSubset<T, TaskTraceFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TaskTrace.
     * @param {TaskTraceCreateArgs} args - Arguments to create a TaskTrace.
     * @example
     * // Create one TaskTrace
     * const TaskTrace = await prisma.taskTrace.create({
     *   data: {
     *     // ... data to create a TaskTrace
     *   }
     * })
     * 
     */
    create<T extends TaskTraceCreateArgs>(args: SelectSubset<T, TaskTraceCreateArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TaskTraces.
     * @param {TaskTraceCreateManyArgs} args - Arguments to create many TaskTraces.
     * @example
     * // Create many TaskTraces
     * const taskTrace = await prisma.taskTrace.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TaskTraceCreateManyArgs>(args?: SelectSubset<T, TaskTraceCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TaskTraces and returns the data saved in the database.
     * @param {TaskTraceCreateManyAndReturnArgs} args - Arguments to create many TaskTraces.
     * @example
     * // Create many TaskTraces
     * const taskTrace = await prisma.taskTrace.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TaskTraces and only return the `id`
     * const taskTraceWithIdOnly = await prisma.taskTrace.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TaskTraceCreateManyAndReturnArgs>(args?: SelectSubset<T, TaskTraceCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TaskTrace.
     * @param {TaskTraceDeleteArgs} args - Arguments to delete one TaskTrace.
     * @example
     * // Delete one TaskTrace
     * const TaskTrace = await prisma.taskTrace.delete({
     *   where: {
     *     // ... filter to delete one TaskTrace
     *   }
     * })
     * 
     */
    delete<T extends TaskTraceDeleteArgs>(args: SelectSubset<T, TaskTraceDeleteArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TaskTrace.
     * @param {TaskTraceUpdateArgs} args - Arguments to update one TaskTrace.
     * @example
     * // Update one TaskTrace
     * const taskTrace = await prisma.taskTrace.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TaskTraceUpdateArgs>(args: SelectSubset<T, TaskTraceUpdateArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TaskTraces.
     * @param {TaskTraceDeleteManyArgs} args - Arguments to filter TaskTraces to delete.
     * @example
     * // Delete a few TaskTraces
     * const { count } = await prisma.taskTrace.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TaskTraceDeleteManyArgs>(args?: SelectSubset<T, TaskTraceDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TaskTraces.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TaskTraces
     * const taskTrace = await prisma.taskTrace.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TaskTraceUpdateManyArgs>(args: SelectSubset<T, TaskTraceUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TaskTrace.
     * @param {TaskTraceUpsertArgs} args - Arguments to update or create a TaskTrace.
     * @example
     * // Update or create a TaskTrace
     * const taskTrace = await prisma.taskTrace.upsert({
     *   create: {
     *     // ... data to create a TaskTrace
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TaskTrace we want to update
     *   }
     * })
     */
    upsert<T extends TaskTraceUpsertArgs>(args: SelectSubset<T, TaskTraceUpsertArgs<ExtArgs>>): Prisma__TaskTraceClient<$Result.GetResult<Prisma.$TaskTracePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TaskTraces.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceCountArgs} args - Arguments to filter TaskTraces to count.
     * @example
     * // Count the number of TaskTraces
     * const count = await prisma.taskTrace.count({
     *   where: {
     *     // ... the filter for the TaskTraces we want to count
     *   }
     * })
    **/
    count<T extends TaskTraceCountArgs>(
      args?: Subset<T, TaskTraceCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TaskTraceCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TaskTrace.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TaskTraceAggregateArgs>(args: Subset<T, TaskTraceAggregateArgs>): Prisma.PrismaPromise<GetTaskTraceAggregateType<T>>

    /**
     * Group by TaskTrace.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskTraceGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TaskTraceGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TaskTraceGroupByArgs['orderBy'] }
        : { orderBy?: TaskTraceGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TaskTraceGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTaskTraceGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TaskTrace model
   */
  readonly fields: TaskTraceFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TaskTrace.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TaskTraceClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    task<T extends TaskDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TaskDefaultArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the TaskTrace model
   */ 
  interface TaskTraceFieldRefs {
    readonly id: FieldRef<"TaskTrace", 'String'>
    readonly taskId: FieldRef<"TaskTrace", 'String'>
    readonly stepId: FieldRef<"TaskTrace", 'String'>
    readonly role: FieldRef<"TaskTrace", 'String'>
    readonly content: FieldRef<"TaskTrace", 'String'>
    readonly toolCalls: FieldRef<"TaskTrace", 'String'>
    readonly createdAt: FieldRef<"TaskTrace", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TaskTrace findUnique
   */
  export type TaskTraceFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * Filter, which TaskTrace to fetch.
     */
    where: TaskTraceWhereUniqueInput
  }

  /**
   * TaskTrace findUniqueOrThrow
   */
  export type TaskTraceFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * Filter, which TaskTrace to fetch.
     */
    where: TaskTraceWhereUniqueInput
  }

  /**
   * TaskTrace findFirst
   */
  export type TaskTraceFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * Filter, which TaskTrace to fetch.
     */
    where?: TaskTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskTraces to fetch.
     */
    orderBy?: TaskTraceOrderByWithRelationInput | TaskTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TaskTraces.
     */
    cursor?: TaskTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskTraces.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TaskTraces.
     */
    distinct?: TaskTraceScalarFieldEnum | TaskTraceScalarFieldEnum[]
  }

  /**
   * TaskTrace findFirstOrThrow
   */
  export type TaskTraceFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * Filter, which TaskTrace to fetch.
     */
    where?: TaskTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskTraces to fetch.
     */
    orderBy?: TaskTraceOrderByWithRelationInput | TaskTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TaskTraces.
     */
    cursor?: TaskTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskTraces.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TaskTraces.
     */
    distinct?: TaskTraceScalarFieldEnum | TaskTraceScalarFieldEnum[]
  }

  /**
   * TaskTrace findMany
   */
  export type TaskTraceFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * Filter, which TaskTraces to fetch.
     */
    where?: TaskTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskTraces to fetch.
     */
    orderBy?: TaskTraceOrderByWithRelationInput | TaskTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TaskTraces.
     */
    cursor?: TaskTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskTraces.
     */
    skip?: number
    distinct?: TaskTraceScalarFieldEnum | TaskTraceScalarFieldEnum[]
  }

  /**
   * TaskTrace create
   */
  export type TaskTraceCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * The data needed to create a TaskTrace.
     */
    data: XOR<TaskTraceCreateInput, TaskTraceUncheckedCreateInput>
  }

  /**
   * TaskTrace createMany
   */
  export type TaskTraceCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TaskTraces.
     */
    data: TaskTraceCreateManyInput | TaskTraceCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TaskTrace createManyAndReturn
   */
  export type TaskTraceCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TaskTraces.
     */
    data: TaskTraceCreateManyInput | TaskTraceCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TaskTrace update
   */
  export type TaskTraceUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * The data needed to update a TaskTrace.
     */
    data: XOR<TaskTraceUpdateInput, TaskTraceUncheckedUpdateInput>
    /**
     * Choose, which TaskTrace to update.
     */
    where: TaskTraceWhereUniqueInput
  }

  /**
   * TaskTrace updateMany
   */
  export type TaskTraceUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TaskTraces.
     */
    data: XOR<TaskTraceUpdateManyMutationInput, TaskTraceUncheckedUpdateManyInput>
    /**
     * Filter which TaskTraces to update
     */
    where?: TaskTraceWhereInput
  }

  /**
   * TaskTrace upsert
   */
  export type TaskTraceUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * The filter to search for the TaskTrace to update in case it exists.
     */
    where: TaskTraceWhereUniqueInput
    /**
     * In case the TaskTrace found by the `where` argument doesn't exist, create a new TaskTrace with this data.
     */
    create: XOR<TaskTraceCreateInput, TaskTraceUncheckedCreateInput>
    /**
     * In case the TaskTrace was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TaskTraceUpdateInput, TaskTraceUncheckedUpdateInput>
  }

  /**
   * TaskTrace delete
   */
  export type TaskTraceDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
    /**
     * Filter which TaskTrace to delete.
     */
    where: TaskTraceWhereUniqueInput
  }

  /**
   * TaskTrace deleteMany
   */
  export type TaskTraceDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TaskTraces to delete
     */
    where?: TaskTraceWhereInput
  }

  /**
   * TaskTrace without action
   */
  export type TaskTraceDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskTrace
     */
    select?: TaskTraceSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskTraceInclude<ExtArgs> | null
  }


  /**
   * Model TaskDiff
   */

  export type AggregateTaskDiff = {
    _count: TaskDiffCountAggregateOutputType | null
    _min: TaskDiffMinAggregateOutputType | null
    _max: TaskDiffMaxAggregateOutputType | null
  }

  export type TaskDiffMinAggregateOutputType = {
    id: string | null
    taskId: string | null
    branch: string | null
    commitSha: string | null
    patch: string | null
    createdAt: Date | null
  }

  export type TaskDiffMaxAggregateOutputType = {
    id: string | null
    taskId: string | null
    branch: string | null
    commitSha: string | null
    patch: string | null
    createdAt: Date | null
  }

  export type TaskDiffCountAggregateOutputType = {
    id: number
    taskId: number
    branch: number
    commitSha: number
    patch: number
    createdAt: number
    _all: number
  }


  export type TaskDiffMinAggregateInputType = {
    id?: true
    taskId?: true
    branch?: true
    commitSha?: true
    patch?: true
    createdAt?: true
  }

  export type TaskDiffMaxAggregateInputType = {
    id?: true
    taskId?: true
    branch?: true
    commitSha?: true
    patch?: true
    createdAt?: true
  }

  export type TaskDiffCountAggregateInputType = {
    id?: true
    taskId?: true
    branch?: true
    commitSha?: true
    patch?: true
    createdAt?: true
    _all?: true
  }

  export type TaskDiffAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TaskDiff to aggregate.
     */
    where?: TaskDiffWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskDiffs to fetch.
     */
    orderBy?: TaskDiffOrderByWithRelationInput | TaskDiffOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TaskDiffWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskDiffs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskDiffs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TaskDiffs
    **/
    _count?: true | TaskDiffCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TaskDiffMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TaskDiffMaxAggregateInputType
  }

  export type GetTaskDiffAggregateType<T extends TaskDiffAggregateArgs> = {
        [P in keyof T & keyof AggregateTaskDiff]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTaskDiff[P]>
      : GetScalarType<T[P], AggregateTaskDiff[P]>
  }




  export type TaskDiffGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TaskDiffWhereInput
    orderBy?: TaskDiffOrderByWithAggregationInput | TaskDiffOrderByWithAggregationInput[]
    by: TaskDiffScalarFieldEnum[] | TaskDiffScalarFieldEnum
    having?: TaskDiffScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TaskDiffCountAggregateInputType | true
    _min?: TaskDiffMinAggregateInputType
    _max?: TaskDiffMaxAggregateInputType
  }

  export type TaskDiffGroupByOutputType = {
    id: string
    taskId: string
    branch: string
    commitSha: string | null
    patch: string
    createdAt: Date
    _count: TaskDiffCountAggregateOutputType | null
    _min: TaskDiffMinAggregateOutputType | null
    _max: TaskDiffMaxAggregateOutputType | null
  }

  type GetTaskDiffGroupByPayload<T extends TaskDiffGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TaskDiffGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TaskDiffGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TaskDiffGroupByOutputType[P]>
            : GetScalarType<T[P], TaskDiffGroupByOutputType[P]>
        }
      >
    >


  export type TaskDiffSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    branch?: boolean
    commitSha?: boolean
    patch?: boolean
    createdAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["taskDiff"]>

  export type TaskDiffSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    branch?: boolean
    commitSha?: boolean
    patch?: boolean
    createdAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["taskDiff"]>

  export type TaskDiffSelectScalar = {
    id?: boolean
    taskId?: boolean
    branch?: boolean
    commitSha?: boolean
    patch?: boolean
    createdAt?: boolean
  }

  export type TaskDiffInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }
  export type TaskDiffIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }

  export type $TaskDiffPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TaskDiff"
    objects: {
      task: Prisma.$TaskPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      taskId: string
      branch: string
      commitSha: string | null
      patch: string
      createdAt: Date
    }, ExtArgs["result"]["taskDiff"]>
    composites: {}
  }

  type TaskDiffGetPayload<S extends boolean | null | undefined | TaskDiffDefaultArgs> = $Result.GetResult<Prisma.$TaskDiffPayload, S>

  type TaskDiffCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TaskDiffFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TaskDiffCountAggregateInputType | true
    }

  export interface TaskDiffDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TaskDiff'], meta: { name: 'TaskDiff' } }
    /**
     * Find zero or one TaskDiff that matches the filter.
     * @param {TaskDiffFindUniqueArgs} args - Arguments to find a TaskDiff
     * @example
     * // Get one TaskDiff
     * const taskDiff = await prisma.taskDiff.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TaskDiffFindUniqueArgs>(args: SelectSubset<T, TaskDiffFindUniqueArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TaskDiff that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TaskDiffFindUniqueOrThrowArgs} args - Arguments to find a TaskDiff
     * @example
     * // Get one TaskDiff
     * const taskDiff = await prisma.taskDiff.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TaskDiffFindUniqueOrThrowArgs>(args: SelectSubset<T, TaskDiffFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TaskDiff that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffFindFirstArgs} args - Arguments to find a TaskDiff
     * @example
     * // Get one TaskDiff
     * const taskDiff = await prisma.taskDiff.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TaskDiffFindFirstArgs>(args?: SelectSubset<T, TaskDiffFindFirstArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TaskDiff that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffFindFirstOrThrowArgs} args - Arguments to find a TaskDiff
     * @example
     * // Get one TaskDiff
     * const taskDiff = await prisma.taskDiff.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TaskDiffFindFirstOrThrowArgs>(args?: SelectSubset<T, TaskDiffFindFirstOrThrowArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TaskDiffs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TaskDiffs
     * const taskDiffs = await prisma.taskDiff.findMany()
     * 
     * // Get first 10 TaskDiffs
     * const taskDiffs = await prisma.taskDiff.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const taskDiffWithIdOnly = await prisma.taskDiff.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TaskDiffFindManyArgs>(args?: SelectSubset<T, TaskDiffFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TaskDiff.
     * @param {TaskDiffCreateArgs} args - Arguments to create a TaskDiff.
     * @example
     * // Create one TaskDiff
     * const TaskDiff = await prisma.taskDiff.create({
     *   data: {
     *     // ... data to create a TaskDiff
     *   }
     * })
     * 
     */
    create<T extends TaskDiffCreateArgs>(args: SelectSubset<T, TaskDiffCreateArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TaskDiffs.
     * @param {TaskDiffCreateManyArgs} args - Arguments to create many TaskDiffs.
     * @example
     * // Create many TaskDiffs
     * const taskDiff = await prisma.taskDiff.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TaskDiffCreateManyArgs>(args?: SelectSubset<T, TaskDiffCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TaskDiffs and returns the data saved in the database.
     * @param {TaskDiffCreateManyAndReturnArgs} args - Arguments to create many TaskDiffs.
     * @example
     * // Create many TaskDiffs
     * const taskDiff = await prisma.taskDiff.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TaskDiffs and only return the `id`
     * const taskDiffWithIdOnly = await prisma.taskDiff.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TaskDiffCreateManyAndReturnArgs>(args?: SelectSubset<T, TaskDiffCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TaskDiff.
     * @param {TaskDiffDeleteArgs} args - Arguments to delete one TaskDiff.
     * @example
     * // Delete one TaskDiff
     * const TaskDiff = await prisma.taskDiff.delete({
     *   where: {
     *     // ... filter to delete one TaskDiff
     *   }
     * })
     * 
     */
    delete<T extends TaskDiffDeleteArgs>(args: SelectSubset<T, TaskDiffDeleteArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TaskDiff.
     * @param {TaskDiffUpdateArgs} args - Arguments to update one TaskDiff.
     * @example
     * // Update one TaskDiff
     * const taskDiff = await prisma.taskDiff.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TaskDiffUpdateArgs>(args: SelectSubset<T, TaskDiffUpdateArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TaskDiffs.
     * @param {TaskDiffDeleteManyArgs} args - Arguments to filter TaskDiffs to delete.
     * @example
     * // Delete a few TaskDiffs
     * const { count } = await prisma.taskDiff.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TaskDiffDeleteManyArgs>(args?: SelectSubset<T, TaskDiffDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TaskDiffs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TaskDiffs
     * const taskDiff = await prisma.taskDiff.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TaskDiffUpdateManyArgs>(args: SelectSubset<T, TaskDiffUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TaskDiff.
     * @param {TaskDiffUpsertArgs} args - Arguments to update or create a TaskDiff.
     * @example
     * // Update or create a TaskDiff
     * const taskDiff = await prisma.taskDiff.upsert({
     *   create: {
     *     // ... data to create a TaskDiff
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TaskDiff we want to update
     *   }
     * })
     */
    upsert<T extends TaskDiffUpsertArgs>(args: SelectSubset<T, TaskDiffUpsertArgs<ExtArgs>>): Prisma__TaskDiffClient<$Result.GetResult<Prisma.$TaskDiffPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TaskDiffs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffCountArgs} args - Arguments to filter TaskDiffs to count.
     * @example
     * // Count the number of TaskDiffs
     * const count = await prisma.taskDiff.count({
     *   where: {
     *     // ... the filter for the TaskDiffs we want to count
     *   }
     * })
    **/
    count<T extends TaskDiffCountArgs>(
      args?: Subset<T, TaskDiffCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TaskDiffCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TaskDiff.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TaskDiffAggregateArgs>(args: Subset<T, TaskDiffAggregateArgs>): Prisma.PrismaPromise<GetTaskDiffAggregateType<T>>

    /**
     * Group by TaskDiff.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TaskDiffGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TaskDiffGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TaskDiffGroupByArgs['orderBy'] }
        : { orderBy?: TaskDiffGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TaskDiffGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTaskDiffGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TaskDiff model
   */
  readonly fields: TaskDiffFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TaskDiff.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TaskDiffClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    task<T extends TaskDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TaskDefaultArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the TaskDiff model
   */ 
  interface TaskDiffFieldRefs {
    readonly id: FieldRef<"TaskDiff", 'String'>
    readonly taskId: FieldRef<"TaskDiff", 'String'>
    readonly branch: FieldRef<"TaskDiff", 'String'>
    readonly commitSha: FieldRef<"TaskDiff", 'String'>
    readonly patch: FieldRef<"TaskDiff", 'String'>
    readonly createdAt: FieldRef<"TaskDiff", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * TaskDiff findUnique
   */
  export type TaskDiffFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * Filter, which TaskDiff to fetch.
     */
    where: TaskDiffWhereUniqueInput
  }

  /**
   * TaskDiff findUniqueOrThrow
   */
  export type TaskDiffFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * Filter, which TaskDiff to fetch.
     */
    where: TaskDiffWhereUniqueInput
  }

  /**
   * TaskDiff findFirst
   */
  export type TaskDiffFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * Filter, which TaskDiff to fetch.
     */
    where?: TaskDiffWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskDiffs to fetch.
     */
    orderBy?: TaskDiffOrderByWithRelationInput | TaskDiffOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TaskDiffs.
     */
    cursor?: TaskDiffWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskDiffs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskDiffs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TaskDiffs.
     */
    distinct?: TaskDiffScalarFieldEnum | TaskDiffScalarFieldEnum[]
  }

  /**
   * TaskDiff findFirstOrThrow
   */
  export type TaskDiffFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * Filter, which TaskDiff to fetch.
     */
    where?: TaskDiffWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskDiffs to fetch.
     */
    orderBy?: TaskDiffOrderByWithRelationInput | TaskDiffOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TaskDiffs.
     */
    cursor?: TaskDiffWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskDiffs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskDiffs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TaskDiffs.
     */
    distinct?: TaskDiffScalarFieldEnum | TaskDiffScalarFieldEnum[]
  }

  /**
   * TaskDiff findMany
   */
  export type TaskDiffFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * Filter, which TaskDiffs to fetch.
     */
    where?: TaskDiffWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TaskDiffs to fetch.
     */
    orderBy?: TaskDiffOrderByWithRelationInput | TaskDiffOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TaskDiffs.
     */
    cursor?: TaskDiffWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TaskDiffs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TaskDiffs.
     */
    skip?: number
    distinct?: TaskDiffScalarFieldEnum | TaskDiffScalarFieldEnum[]
  }

  /**
   * TaskDiff create
   */
  export type TaskDiffCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * The data needed to create a TaskDiff.
     */
    data: XOR<TaskDiffCreateInput, TaskDiffUncheckedCreateInput>
  }

  /**
   * TaskDiff createMany
   */
  export type TaskDiffCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TaskDiffs.
     */
    data: TaskDiffCreateManyInput | TaskDiffCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TaskDiff createManyAndReturn
   */
  export type TaskDiffCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TaskDiffs.
     */
    data: TaskDiffCreateManyInput | TaskDiffCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TaskDiff update
   */
  export type TaskDiffUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * The data needed to update a TaskDiff.
     */
    data: XOR<TaskDiffUpdateInput, TaskDiffUncheckedUpdateInput>
    /**
     * Choose, which TaskDiff to update.
     */
    where: TaskDiffWhereUniqueInput
  }

  /**
   * TaskDiff updateMany
   */
  export type TaskDiffUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TaskDiffs.
     */
    data: XOR<TaskDiffUpdateManyMutationInput, TaskDiffUncheckedUpdateManyInput>
    /**
     * Filter which TaskDiffs to update
     */
    where?: TaskDiffWhereInput
  }

  /**
   * TaskDiff upsert
   */
  export type TaskDiffUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * The filter to search for the TaskDiff to update in case it exists.
     */
    where: TaskDiffWhereUniqueInput
    /**
     * In case the TaskDiff found by the `where` argument doesn't exist, create a new TaskDiff with this data.
     */
    create: XOR<TaskDiffCreateInput, TaskDiffUncheckedCreateInput>
    /**
     * In case the TaskDiff was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TaskDiffUpdateInput, TaskDiffUncheckedUpdateInput>
  }

  /**
   * TaskDiff delete
   */
  export type TaskDiffDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
    /**
     * Filter which TaskDiff to delete.
     */
    where: TaskDiffWhereUniqueInput
  }

  /**
   * TaskDiff deleteMany
   */
  export type TaskDiffDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TaskDiffs to delete
     */
    where?: TaskDiffWhereInput
  }

  /**
   * TaskDiff without action
   */
  export type TaskDiffDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TaskDiff
     */
    select?: TaskDiffSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskDiffInclude<ExtArgs> | null
  }


  /**
   * Model AgentRun
   */

  export type AggregateAgentRun = {
    _count: AgentRunCountAggregateOutputType | null
    _avg: AgentRunAvgAggregateOutputType | null
    _sum: AgentRunSumAggregateOutputType | null
    _min: AgentRunMinAggregateOutputType | null
    _max: AgentRunMaxAggregateOutputType | null
  }

  export type AgentRunAvgAggregateOutputType = {
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
  }

  export type AgentRunSumAggregateOutputType = {
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
  }

  export type AgentRunMinAggregateOutputType = {
    id: string | null
    taskId: string | null
    branch: string | null
    baseCommit: string | null
    resultStatus: string | null
    validationSummary: string | null
    publishedVersion: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AgentRunMaxAggregateOutputType = {
    id: string | null
    taskId: string | null
    branch: string | null
    baseCommit: string | null
    resultStatus: string | null
    validationSummary: string | null
    publishedVersion: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type AgentRunCountAggregateOutputType = {
    id: number
    taskId: number
    branch: number
    baseCommit: number
    resultStatus: number
    validationSummary: number
    publishedVersion: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type AgentRunAvgAggregateInputType = {
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
  }

  export type AgentRunSumAggregateInputType = {
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
  }

  export type AgentRunMinAggregateInputType = {
    id?: true
    taskId?: true
    branch?: true
    baseCommit?: true
    resultStatus?: true
    validationSummary?: true
    publishedVersion?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AgentRunMaxAggregateInputType = {
    id?: true
    taskId?: true
    branch?: true
    baseCommit?: true
    resultStatus?: true
    validationSummary?: true
    publishedVersion?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    createdAt?: true
    updatedAt?: true
  }

  export type AgentRunCountAggregateInputType = {
    id?: true
    taskId?: true
    branch?: true
    baseCommit?: true
    resultStatus?: true
    validationSummary?: true
    publishedVersion?: true
    promptTokens?: true
    completionTokens?: true
    totalTokens?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type AgentRunAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentRun to aggregate.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AgentRuns
    **/
    _count?: true | AgentRunCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: AgentRunAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: AgentRunSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AgentRunMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AgentRunMaxAggregateInputType
  }

  export type GetAgentRunAggregateType<T extends AgentRunAggregateArgs> = {
        [P in keyof T & keyof AggregateAgentRun]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgentRun[P]>
      : GetScalarType<T[P], AggregateAgentRun[P]>
  }




  export type AgentRunGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentRunWhereInput
    orderBy?: AgentRunOrderByWithAggregationInput | AgentRunOrderByWithAggregationInput[]
    by: AgentRunScalarFieldEnum[] | AgentRunScalarFieldEnum
    having?: AgentRunScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AgentRunCountAggregateInputType | true
    _avg?: AgentRunAvgAggregateInputType
    _sum?: AgentRunSumAggregateInputType
    _min?: AgentRunMinAggregateInputType
    _max?: AgentRunMaxAggregateInputType
  }

  export type AgentRunGroupByOutputType = {
    id: string
    taskId: string
    branch: string
    baseCommit: string
    resultStatus: string
    validationSummary: string | null
    publishedVersion: string | null
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    createdAt: Date
    updatedAt: Date
    _count: AgentRunCountAggregateOutputType | null
    _avg: AgentRunAvgAggregateOutputType | null
    _sum: AgentRunSumAggregateOutputType | null
    _min: AgentRunMinAggregateOutputType | null
    _max: AgentRunMaxAggregateOutputType | null
  }

  type GetAgentRunGroupByPayload<T extends AgentRunGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AgentRunGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AgentRunGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AgentRunGroupByOutputType[P]>
            : GetScalarType<T[P], AgentRunGroupByOutputType[P]>
        }
      >
    >


  export type AgentRunSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    branch?: boolean
    baseCommit?: boolean
    resultStatus?: boolean
    validationSummary?: boolean
    publishedVersion?: boolean
    promptTokens?: boolean
    completionTokens?: boolean
    totalTokens?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentRun"]>

  export type AgentRunSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    taskId?: boolean
    branch?: boolean
    baseCommit?: boolean
    resultStatus?: boolean
    validationSummary?: boolean
    publishedVersion?: boolean
    promptTokens?: boolean
    completionTokens?: boolean
    totalTokens?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["agentRun"]>

  export type AgentRunSelectScalar = {
    id?: boolean
    taskId?: boolean
    branch?: boolean
    baseCommit?: boolean
    resultStatus?: boolean
    validationSummary?: boolean
    publishedVersion?: boolean
    promptTokens?: boolean
    completionTokens?: boolean
    totalTokens?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type AgentRunInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }
  export type AgentRunIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TaskDefaultArgs<ExtArgs>
  }

  export type $AgentRunPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AgentRun"
    objects: {
      task: Prisma.$TaskPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      taskId: string
      branch: string
      baseCommit: string
      resultStatus: string
      validationSummary: string | null
      publishedVersion: string | null
      promptTokens: number | null
      completionTokens: number | null
      totalTokens: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agentRun"]>
    composites: {}
  }

  type AgentRunGetPayload<S extends boolean | null | undefined | AgentRunDefaultArgs> = $Result.GetResult<Prisma.$AgentRunPayload, S>

  type AgentRunCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AgentRunFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AgentRunCountAggregateInputType | true
    }

  export interface AgentRunDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AgentRun'], meta: { name: 'AgentRun' } }
    /**
     * Find zero or one AgentRun that matches the filter.
     * @param {AgentRunFindUniqueArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AgentRunFindUniqueArgs>(args: SelectSubset<T, AgentRunFindUniqueArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one AgentRun that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AgentRunFindUniqueOrThrowArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AgentRunFindUniqueOrThrowArgs>(args: SelectSubset<T, AgentRunFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first AgentRun that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunFindFirstArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AgentRunFindFirstArgs>(args?: SelectSubset<T, AgentRunFindFirstArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first AgentRun that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunFindFirstOrThrowArgs} args - Arguments to find a AgentRun
     * @example
     * // Get one AgentRun
     * const agentRun = await prisma.agentRun.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AgentRunFindFirstOrThrowArgs>(args?: SelectSubset<T, AgentRunFindFirstOrThrowArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more AgentRuns that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AgentRuns
     * const agentRuns = await prisma.agentRun.findMany()
     * 
     * // Get first 10 AgentRuns
     * const agentRuns = await prisma.agentRun.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agentRunWithIdOnly = await prisma.agentRun.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AgentRunFindManyArgs>(args?: SelectSubset<T, AgentRunFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a AgentRun.
     * @param {AgentRunCreateArgs} args - Arguments to create a AgentRun.
     * @example
     * // Create one AgentRun
     * const AgentRun = await prisma.agentRun.create({
     *   data: {
     *     // ... data to create a AgentRun
     *   }
     * })
     * 
     */
    create<T extends AgentRunCreateArgs>(args: SelectSubset<T, AgentRunCreateArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many AgentRuns.
     * @param {AgentRunCreateManyArgs} args - Arguments to create many AgentRuns.
     * @example
     * // Create many AgentRuns
     * const agentRun = await prisma.agentRun.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AgentRunCreateManyArgs>(args?: SelectSubset<T, AgentRunCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AgentRuns and returns the data saved in the database.
     * @param {AgentRunCreateManyAndReturnArgs} args - Arguments to create many AgentRuns.
     * @example
     * // Create many AgentRuns
     * const agentRun = await prisma.agentRun.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AgentRuns and only return the `id`
     * const agentRunWithIdOnly = await prisma.agentRun.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AgentRunCreateManyAndReturnArgs>(args?: SelectSubset<T, AgentRunCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a AgentRun.
     * @param {AgentRunDeleteArgs} args - Arguments to delete one AgentRun.
     * @example
     * // Delete one AgentRun
     * const AgentRun = await prisma.agentRun.delete({
     *   where: {
     *     // ... filter to delete one AgentRun
     *   }
     * })
     * 
     */
    delete<T extends AgentRunDeleteArgs>(args: SelectSubset<T, AgentRunDeleteArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one AgentRun.
     * @param {AgentRunUpdateArgs} args - Arguments to update one AgentRun.
     * @example
     * // Update one AgentRun
     * const agentRun = await prisma.agentRun.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AgentRunUpdateArgs>(args: SelectSubset<T, AgentRunUpdateArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more AgentRuns.
     * @param {AgentRunDeleteManyArgs} args - Arguments to filter AgentRuns to delete.
     * @example
     * // Delete a few AgentRuns
     * const { count } = await prisma.agentRun.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AgentRunDeleteManyArgs>(args?: SelectSubset<T, AgentRunDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentRuns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AgentRuns
     * const agentRun = await prisma.agentRun.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AgentRunUpdateManyArgs>(args: SelectSubset<T, AgentRunUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one AgentRun.
     * @param {AgentRunUpsertArgs} args - Arguments to update or create a AgentRun.
     * @example
     * // Update or create a AgentRun
     * const agentRun = await prisma.agentRun.upsert({
     *   create: {
     *     // ... data to create a AgentRun
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AgentRun we want to update
     *   }
     * })
     */
    upsert<T extends AgentRunUpsertArgs>(args: SelectSubset<T, AgentRunUpsertArgs<ExtArgs>>): Prisma__AgentRunClient<$Result.GetResult<Prisma.$AgentRunPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of AgentRuns.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunCountArgs} args - Arguments to filter AgentRuns to count.
     * @example
     * // Count the number of AgentRuns
     * const count = await prisma.agentRun.count({
     *   where: {
     *     // ... the filter for the AgentRuns we want to count
     *   }
     * })
    **/
    count<T extends AgentRunCountArgs>(
      args?: Subset<T, AgentRunCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AgentRunCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AgentRun.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AgentRunAggregateArgs>(args: Subset<T, AgentRunAggregateArgs>): Prisma.PrismaPromise<GetAgentRunAggregateType<T>>

    /**
     * Group by AgentRun.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentRunGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AgentRunGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AgentRunGroupByArgs['orderBy'] }
        : { orderBy?: AgentRunGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AgentRunGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgentRunGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AgentRun model
   */
  readonly fields: AgentRunFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AgentRun.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AgentRunClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    task<T extends TaskDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TaskDefaultArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AgentRun model
   */ 
  interface AgentRunFieldRefs {
    readonly id: FieldRef<"AgentRun", 'String'>
    readonly taskId: FieldRef<"AgentRun", 'String'>
    readonly branch: FieldRef<"AgentRun", 'String'>
    readonly baseCommit: FieldRef<"AgentRun", 'String'>
    readonly resultStatus: FieldRef<"AgentRun", 'String'>
    readonly validationSummary: FieldRef<"AgentRun", 'String'>
    readonly publishedVersion: FieldRef<"AgentRun", 'String'>
    readonly promptTokens: FieldRef<"AgentRun", 'Int'>
    readonly completionTokens: FieldRef<"AgentRun", 'Int'>
    readonly totalTokens: FieldRef<"AgentRun", 'Int'>
    readonly createdAt: FieldRef<"AgentRun", 'DateTime'>
    readonly updatedAt: FieldRef<"AgentRun", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AgentRun findUnique
   */
  export type AgentRunFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun findUniqueOrThrow
   */
  export type AgentRunFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun findFirst
   */
  export type AgentRunFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentRuns.
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentRuns.
     */
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentRun findFirstOrThrow
   */
  export type AgentRunFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRun to fetch.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentRuns.
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentRuns.
     */
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentRun findMany
   */
  export type AgentRunFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter, which AgentRuns to fetch.
     */
    where?: AgentRunWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentRuns to fetch.
     */
    orderBy?: AgentRunOrderByWithRelationInput | AgentRunOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AgentRuns.
     */
    cursor?: AgentRunWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentRuns from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentRuns.
     */
    skip?: number
    distinct?: AgentRunScalarFieldEnum | AgentRunScalarFieldEnum[]
  }

  /**
   * AgentRun create
   */
  export type AgentRunCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * The data needed to create a AgentRun.
     */
    data: XOR<AgentRunCreateInput, AgentRunUncheckedCreateInput>
  }

  /**
   * AgentRun createMany
   */
  export type AgentRunCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AgentRuns.
     */
    data: AgentRunCreateManyInput | AgentRunCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentRun createManyAndReturn
   */
  export type AgentRunCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many AgentRuns.
     */
    data: AgentRunCreateManyInput | AgentRunCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AgentRun update
   */
  export type AgentRunUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * The data needed to update a AgentRun.
     */
    data: XOR<AgentRunUpdateInput, AgentRunUncheckedUpdateInput>
    /**
     * Choose, which AgentRun to update.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun updateMany
   */
  export type AgentRunUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AgentRuns.
     */
    data: XOR<AgentRunUpdateManyMutationInput, AgentRunUncheckedUpdateManyInput>
    /**
     * Filter which AgentRuns to update
     */
    where?: AgentRunWhereInput
  }

  /**
   * AgentRun upsert
   */
  export type AgentRunUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * The filter to search for the AgentRun to update in case it exists.
     */
    where: AgentRunWhereUniqueInput
    /**
     * In case the AgentRun found by the `where` argument doesn't exist, create a new AgentRun with this data.
     */
    create: XOR<AgentRunCreateInput, AgentRunUncheckedCreateInput>
    /**
     * In case the AgentRun was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AgentRunUpdateInput, AgentRunUncheckedUpdateInput>
  }

  /**
   * AgentRun delete
   */
  export type AgentRunDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
    /**
     * Filter which AgentRun to delete.
     */
    where: AgentRunWhereUniqueInput
  }

  /**
   * AgentRun deleteMany
   */
  export type AgentRunDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentRuns to delete
     */
    where?: AgentRunWhereInput
  }

  /**
   * AgentRun without action
   */
  export type AgentRunDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentRun
     */
    select?: AgentRunSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentRunInclude<ExtArgs> | null
  }


  /**
   * Model TraceSpan
   */

  export type AggregateTraceSpan = {
    _count: TraceSpanCountAggregateOutputType | null
    _min: TraceSpanMinAggregateOutputType | null
    _max: TraceSpanMaxAggregateOutputType | null
  }

  export type TraceSpanMinAggregateOutputType = {
    id: string | null
    traceId: string | null
    spanId: string | null
    parentId: string | null
    taskId: string | null
    name: string | null
    startTime: Date | null
    endTime: Date | null
    status: string | null
    attributes: string | null
    events: string | null
  }

  export type TraceSpanMaxAggregateOutputType = {
    id: string | null
    traceId: string | null
    spanId: string | null
    parentId: string | null
    taskId: string | null
    name: string | null
    startTime: Date | null
    endTime: Date | null
    status: string | null
    attributes: string | null
    events: string | null
  }

  export type TraceSpanCountAggregateOutputType = {
    id: number
    traceId: number
    spanId: number
    parentId: number
    taskId: number
    name: number
    startTime: number
    endTime: number
    status: number
    attributes: number
    events: number
    _all: number
  }


  export type TraceSpanMinAggregateInputType = {
    id?: true
    traceId?: true
    spanId?: true
    parentId?: true
    taskId?: true
    name?: true
    startTime?: true
    endTime?: true
    status?: true
    attributes?: true
    events?: true
  }

  export type TraceSpanMaxAggregateInputType = {
    id?: true
    traceId?: true
    spanId?: true
    parentId?: true
    taskId?: true
    name?: true
    startTime?: true
    endTime?: true
    status?: true
    attributes?: true
    events?: true
  }

  export type TraceSpanCountAggregateInputType = {
    id?: true
    traceId?: true
    spanId?: true
    parentId?: true
    taskId?: true
    name?: true
    startTime?: true
    endTime?: true
    status?: true
    attributes?: true
    events?: true
    _all?: true
  }

  export type TraceSpanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TraceSpan to aggregate.
     */
    where?: TraceSpanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TraceSpans to fetch.
     */
    orderBy?: TraceSpanOrderByWithRelationInput | TraceSpanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TraceSpanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TraceSpans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TraceSpans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TraceSpans
    **/
    _count?: true | TraceSpanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TraceSpanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TraceSpanMaxAggregateInputType
  }

  export type GetTraceSpanAggregateType<T extends TraceSpanAggregateArgs> = {
        [P in keyof T & keyof AggregateTraceSpan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTraceSpan[P]>
      : GetScalarType<T[P], AggregateTraceSpan[P]>
  }




  export type TraceSpanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TraceSpanWhereInput
    orderBy?: TraceSpanOrderByWithAggregationInput | TraceSpanOrderByWithAggregationInput[]
    by: TraceSpanScalarFieldEnum[] | TraceSpanScalarFieldEnum
    having?: TraceSpanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TraceSpanCountAggregateInputType | true
    _min?: TraceSpanMinAggregateInputType
    _max?: TraceSpanMaxAggregateInputType
  }

  export type TraceSpanGroupByOutputType = {
    id: string
    traceId: string
    spanId: string
    parentId: string | null
    taskId: string | null
    name: string
    startTime: Date
    endTime: Date | null
    status: string
    attributes: string | null
    events: string | null
    _count: TraceSpanCountAggregateOutputType | null
    _min: TraceSpanMinAggregateOutputType | null
    _max: TraceSpanMaxAggregateOutputType | null
  }

  type GetTraceSpanGroupByPayload<T extends TraceSpanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TraceSpanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TraceSpanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TraceSpanGroupByOutputType[P]>
            : GetScalarType<T[P], TraceSpanGroupByOutputType[P]>
        }
      >
    >


  export type TraceSpanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    traceId?: boolean
    spanId?: boolean
    parentId?: boolean
    taskId?: boolean
    name?: boolean
    startTime?: boolean
    endTime?: boolean
    status?: boolean
    attributes?: boolean
    events?: boolean
    task?: boolean | TraceSpan$taskArgs<ExtArgs>
  }, ExtArgs["result"]["traceSpan"]>

  export type TraceSpanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    traceId?: boolean
    spanId?: boolean
    parentId?: boolean
    taskId?: boolean
    name?: boolean
    startTime?: boolean
    endTime?: boolean
    status?: boolean
    attributes?: boolean
    events?: boolean
    task?: boolean | TraceSpan$taskArgs<ExtArgs>
  }, ExtArgs["result"]["traceSpan"]>

  export type TraceSpanSelectScalar = {
    id?: boolean
    traceId?: boolean
    spanId?: boolean
    parentId?: boolean
    taskId?: boolean
    name?: boolean
    startTime?: boolean
    endTime?: boolean
    status?: boolean
    attributes?: boolean
    events?: boolean
  }

  export type TraceSpanInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TraceSpan$taskArgs<ExtArgs>
  }
  export type TraceSpanIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    task?: boolean | TraceSpan$taskArgs<ExtArgs>
  }

  export type $TraceSpanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TraceSpan"
    objects: {
      task: Prisma.$TaskPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      traceId: string
      spanId: string
      parentId: string | null
      taskId: string | null
      name: string
      startTime: Date
      endTime: Date | null
      status: string
      attributes: string | null
      events: string | null
    }, ExtArgs["result"]["traceSpan"]>
    composites: {}
  }

  type TraceSpanGetPayload<S extends boolean | null | undefined | TraceSpanDefaultArgs> = $Result.GetResult<Prisma.$TraceSpanPayload, S>

  type TraceSpanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TraceSpanFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TraceSpanCountAggregateInputType | true
    }

  export interface TraceSpanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TraceSpan'], meta: { name: 'TraceSpan' } }
    /**
     * Find zero or one TraceSpan that matches the filter.
     * @param {TraceSpanFindUniqueArgs} args - Arguments to find a TraceSpan
     * @example
     * // Get one TraceSpan
     * const traceSpan = await prisma.traceSpan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TraceSpanFindUniqueArgs>(args: SelectSubset<T, TraceSpanFindUniqueArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one TraceSpan that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TraceSpanFindUniqueOrThrowArgs} args - Arguments to find a TraceSpan
     * @example
     * // Get one TraceSpan
     * const traceSpan = await prisma.traceSpan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TraceSpanFindUniqueOrThrowArgs>(args: SelectSubset<T, TraceSpanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first TraceSpan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanFindFirstArgs} args - Arguments to find a TraceSpan
     * @example
     * // Get one TraceSpan
     * const traceSpan = await prisma.traceSpan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TraceSpanFindFirstArgs>(args?: SelectSubset<T, TraceSpanFindFirstArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first TraceSpan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanFindFirstOrThrowArgs} args - Arguments to find a TraceSpan
     * @example
     * // Get one TraceSpan
     * const traceSpan = await prisma.traceSpan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TraceSpanFindFirstOrThrowArgs>(args?: SelectSubset<T, TraceSpanFindFirstOrThrowArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more TraceSpans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TraceSpans
     * const traceSpans = await prisma.traceSpan.findMany()
     * 
     * // Get first 10 TraceSpans
     * const traceSpans = await prisma.traceSpan.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const traceSpanWithIdOnly = await prisma.traceSpan.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TraceSpanFindManyArgs>(args?: SelectSubset<T, TraceSpanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a TraceSpan.
     * @param {TraceSpanCreateArgs} args - Arguments to create a TraceSpan.
     * @example
     * // Create one TraceSpan
     * const TraceSpan = await prisma.traceSpan.create({
     *   data: {
     *     // ... data to create a TraceSpan
     *   }
     * })
     * 
     */
    create<T extends TraceSpanCreateArgs>(args: SelectSubset<T, TraceSpanCreateArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many TraceSpans.
     * @param {TraceSpanCreateManyArgs} args - Arguments to create many TraceSpans.
     * @example
     * // Create many TraceSpans
     * const traceSpan = await prisma.traceSpan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TraceSpanCreateManyArgs>(args?: SelectSubset<T, TraceSpanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many TraceSpans and returns the data saved in the database.
     * @param {TraceSpanCreateManyAndReturnArgs} args - Arguments to create many TraceSpans.
     * @example
     * // Create many TraceSpans
     * const traceSpan = await prisma.traceSpan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many TraceSpans and only return the `id`
     * const traceSpanWithIdOnly = await prisma.traceSpan.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TraceSpanCreateManyAndReturnArgs>(args?: SelectSubset<T, TraceSpanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a TraceSpan.
     * @param {TraceSpanDeleteArgs} args - Arguments to delete one TraceSpan.
     * @example
     * // Delete one TraceSpan
     * const TraceSpan = await prisma.traceSpan.delete({
     *   where: {
     *     // ... filter to delete one TraceSpan
     *   }
     * })
     * 
     */
    delete<T extends TraceSpanDeleteArgs>(args: SelectSubset<T, TraceSpanDeleteArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one TraceSpan.
     * @param {TraceSpanUpdateArgs} args - Arguments to update one TraceSpan.
     * @example
     * // Update one TraceSpan
     * const traceSpan = await prisma.traceSpan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TraceSpanUpdateArgs>(args: SelectSubset<T, TraceSpanUpdateArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more TraceSpans.
     * @param {TraceSpanDeleteManyArgs} args - Arguments to filter TraceSpans to delete.
     * @example
     * // Delete a few TraceSpans
     * const { count } = await prisma.traceSpan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TraceSpanDeleteManyArgs>(args?: SelectSubset<T, TraceSpanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TraceSpans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TraceSpans
     * const traceSpan = await prisma.traceSpan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TraceSpanUpdateManyArgs>(args: SelectSubset<T, TraceSpanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TraceSpan.
     * @param {TraceSpanUpsertArgs} args - Arguments to update or create a TraceSpan.
     * @example
     * // Update or create a TraceSpan
     * const traceSpan = await prisma.traceSpan.upsert({
     *   create: {
     *     // ... data to create a TraceSpan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TraceSpan we want to update
     *   }
     * })
     */
    upsert<T extends TraceSpanUpsertArgs>(args: SelectSubset<T, TraceSpanUpsertArgs<ExtArgs>>): Prisma__TraceSpanClient<$Result.GetResult<Prisma.$TraceSpanPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of TraceSpans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanCountArgs} args - Arguments to filter TraceSpans to count.
     * @example
     * // Count the number of TraceSpans
     * const count = await prisma.traceSpan.count({
     *   where: {
     *     // ... the filter for the TraceSpans we want to count
     *   }
     * })
    **/
    count<T extends TraceSpanCountArgs>(
      args?: Subset<T, TraceSpanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TraceSpanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TraceSpan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TraceSpanAggregateArgs>(args: Subset<T, TraceSpanAggregateArgs>): Prisma.PrismaPromise<GetTraceSpanAggregateType<T>>

    /**
     * Group by TraceSpan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TraceSpanGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TraceSpanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TraceSpanGroupByArgs['orderBy'] }
        : { orderBy?: TraceSpanGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TraceSpanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTraceSpanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TraceSpan model
   */
  readonly fields: TraceSpanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TraceSpan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TraceSpanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    task<T extends TraceSpan$taskArgs<ExtArgs> = {}>(args?: Subset<T, TraceSpan$taskArgs<ExtArgs>>): Prisma__TaskClient<$Result.GetResult<Prisma.$TaskPayload<ExtArgs>, T, "findUniqueOrThrow"> | null, null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the TraceSpan model
   */ 
  interface TraceSpanFieldRefs {
    readonly id: FieldRef<"TraceSpan", 'String'>
    readonly traceId: FieldRef<"TraceSpan", 'String'>
    readonly spanId: FieldRef<"TraceSpan", 'String'>
    readonly parentId: FieldRef<"TraceSpan", 'String'>
    readonly taskId: FieldRef<"TraceSpan", 'String'>
    readonly name: FieldRef<"TraceSpan", 'String'>
    readonly startTime: FieldRef<"TraceSpan", 'DateTime'>
    readonly endTime: FieldRef<"TraceSpan", 'DateTime'>
    readonly status: FieldRef<"TraceSpan", 'String'>
    readonly attributes: FieldRef<"TraceSpan", 'String'>
    readonly events: FieldRef<"TraceSpan", 'String'>
  }
    

  // Custom InputTypes
  /**
   * TraceSpan findUnique
   */
  export type TraceSpanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * Filter, which TraceSpan to fetch.
     */
    where: TraceSpanWhereUniqueInput
  }

  /**
   * TraceSpan findUniqueOrThrow
   */
  export type TraceSpanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * Filter, which TraceSpan to fetch.
     */
    where: TraceSpanWhereUniqueInput
  }

  /**
   * TraceSpan findFirst
   */
  export type TraceSpanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * Filter, which TraceSpan to fetch.
     */
    where?: TraceSpanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TraceSpans to fetch.
     */
    orderBy?: TraceSpanOrderByWithRelationInput | TraceSpanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TraceSpans.
     */
    cursor?: TraceSpanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TraceSpans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TraceSpans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TraceSpans.
     */
    distinct?: TraceSpanScalarFieldEnum | TraceSpanScalarFieldEnum[]
  }

  /**
   * TraceSpan findFirstOrThrow
   */
  export type TraceSpanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * Filter, which TraceSpan to fetch.
     */
    where?: TraceSpanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TraceSpans to fetch.
     */
    orderBy?: TraceSpanOrderByWithRelationInput | TraceSpanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TraceSpans.
     */
    cursor?: TraceSpanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TraceSpans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TraceSpans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TraceSpans.
     */
    distinct?: TraceSpanScalarFieldEnum | TraceSpanScalarFieldEnum[]
  }

  /**
   * TraceSpan findMany
   */
  export type TraceSpanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * Filter, which TraceSpans to fetch.
     */
    where?: TraceSpanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TraceSpans to fetch.
     */
    orderBy?: TraceSpanOrderByWithRelationInput | TraceSpanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TraceSpans.
     */
    cursor?: TraceSpanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TraceSpans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TraceSpans.
     */
    skip?: number
    distinct?: TraceSpanScalarFieldEnum | TraceSpanScalarFieldEnum[]
  }

  /**
   * TraceSpan create
   */
  export type TraceSpanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * The data needed to create a TraceSpan.
     */
    data: XOR<TraceSpanCreateInput, TraceSpanUncheckedCreateInput>
  }

  /**
   * TraceSpan createMany
   */
  export type TraceSpanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TraceSpans.
     */
    data: TraceSpanCreateManyInput | TraceSpanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * TraceSpan createManyAndReturn
   */
  export type TraceSpanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many TraceSpans.
     */
    data: TraceSpanCreateManyInput | TraceSpanCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * TraceSpan update
   */
  export type TraceSpanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * The data needed to update a TraceSpan.
     */
    data: XOR<TraceSpanUpdateInput, TraceSpanUncheckedUpdateInput>
    /**
     * Choose, which TraceSpan to update.
     */
    where: TraceSpanWhereUniqueInput
  }

  /**
   * TraceSpan updateMany
   */
  export type TraceSpanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TraceSpans.
     */
    data: XOR<TraceSpanUpdateManyMutationInput, TraceSpanUncheckedUpdateManyInput>
    /**
     * Filter which TraceSpans to update
     */
    where?: TraceSpanWhereInput
  }

  /**
   * TraceSpan upsert
   */
  export type TraceSpanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * The filter to search for the TraceSpan to update in case it exists.
     */
    where: TraceSpanWhereUniqueInput
    /**
     * In case the TraceSpan found by the `where` argument doesn't exist, create a new TraceSpan with this data.
     */
    create: XOR<TraceSpanCreateInput, TraceSpanUncheckedCreateInput>
    /**
     * In case the TraceSpan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TraceSpanUpdateInput, TraceSpanUncheckedUpdateInput>
  }

  /**
   * TraceSpan delete
   */
  export type TraceSpanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
    /**
     * Filter which TraceSpan to delete.
     */
    where: TraceSpanWhereUniqueInput
  }

  /**
   * TraceSpan deleteMany
   */
  export type TraceSpanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TraceSpans to delete
     */
    where?: TraceSpanWhereInput
  }

  /**
   * TraceSpan.task
   */
  export type TraceSpan$taskArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Task
     */
    select?: TaskSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TaskInclude<ExtArgs> | null
    where?: TaskWhereInput
  }

  /**
   * TraceSpan without action
   */
  export type TraceSpanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TraceSpan
     */
    select?: TraceSpanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TraceSpanInclude<ExtArgs> | null
  }


  /**
   * Model ProviderConfig
   */

  export type AggregateProviderConfig = {
    _count: ProviderConfigCountAggregateOutputType | null
    _min: ProviderConfigMinAggregateOutputType | null
    _max: ProviderConfigMaxAggregateOutputType | null
  }

  export type ProviderConfigMinAggregateOutputType = {
    id: string | null
    name: string | null
    kind: string | null
    baseUrl: string | null
    apiKey: string | null
    defaultModel: string | null
    capabilities: string | null
    enabled: boolean | null
    createdAt: Date | null
  }

  export type ProviderConfigMaxAggregateOutputType = {
    id: string | null
    name: string | null
    kind: string | null
    baseUrl: string | null
    apiKey: string | null
    defaultModel: string | null
    capabilities: string | null
    enabled: boolean | null
    createdAt: Date | null
  }

  export type ProviderConfigCountAggregateOutputType = {
    id: number
    name: number
    kind: number
    baseUrl: number
    apiKey: number
    defaultModel: number
    capabilities: number
    enabled: number
    createdAt: number
    _all: number
  }


  export type ProviderConfigMinAggregateInputType = {
    id?: true
    name?: true
    kind?: true
    baseUrl?: true
    apiKey?: true
    defaultModel?: true
    capabilities?: true
    enabled?: true
    createdAt?: true
  }

  export type ProviderConfigMaxAggregateInputType = {
    id?: true
    name?: true
    kind?: true
    baseUrl?: true
    apiKey?: true
    defaultModel?: true
    capabilities?: true
    enabled?: true
    createdAt?: true
  }

  export type ProviderConfigCountAggregateInputType = {
    id?: true
    name?: true
    kind?: true
    baseUrl?: true
    apiKey?: true
    defaultModel?: true
    capabilities?: true
    enabled?: true
    createdAt?: true
    _all?: true
  }

  export type ProviderConfigAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ProviderConfig to aggregate.
     */
    where?: ProviderConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProviderConfigs to fetch.
     */
    orderBy?: ProviderConfigOrderByWithRelationInput | ProviderConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ProviderConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProviderConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProviderConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ProviderConfigs
    **/
    _count?: true | ProviderConfigCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ProviderConfigMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ProviderConfigMaxAggregateInputType
  }

  export type GetProviderConfigAggregateType<T extends ProviderConfigAggregateArgs> = {
        [P in keyof T & keyof AggregateProviderConfig]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateProviderConfig[P]>
      : GetScalarType<T[P], AggregateProviderConfig[P]>
  }




  export type ProviderConfigGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProviderConfigWhereInput
    orderBy?: ProviderConfigOrderByWithAggregationInput | ProviderConfigOrderByWithAggregationInput[]
    by: ProviderConfigScalarFieldEnum[] | ProviderConfigScalarFieldEnum
    having?: ProviderConfigScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ProviderConfigCountAggregateInputType | true
    _min?: ProviderConfigMinAggregateInputType
    _max?: ProviderConfigMaxAggregateInputType
  }

  export type ProviderConfigGroupByOutputType = {
    id: string
    name: string
    kind: string
    baseUrl: string | null
    apiKey: string | null
    defaultModel: string
    capabilities: string
    enabled: boolean
    createdAt: Date
    _count: ProviderConfigCountAggregateOutputType | null
    _min: ProviderConfigMinAggregateOutputType | null
    _max: ProviderConfigMaxAggregateOutputType | null
  }

  type GetProviderConfigGroupByPayload<T extends ProviderConfigGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ProviderConfigGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ProviderConfigGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ProviderConfigGroupByOutputType[P]>
            : GetScalarType<T[P], ProviderConfigGroupByOutputType[P]>
        }
      >
    >


  export type ProviderConfigSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    kind?: boolean
    baseUrl?: boolean
    apiKey?: boolean
    defaultModel?: boolean
    capabilities?: boolean
    enabled?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["providerConfig"]>

  export type ProviderConfigSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    kind?: boolean
    baseUrl?: boolean
    apiKey?: boolean
    defaultModel?: boolean
    capabilities?: boolean
    enabled?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["providerConfig"]>

  export type ProviderConfigSelectScalar = {
    id?: boolean
    name?: boolean
    kind?: boolean
    baseUrl?: boolean
    apiKey?: boolean
    defaultModel?: boolean
    capabilities?: boolean
    enabled?: boolean
    createdAt?: boolean
  }


  export type $ProviderConfigPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ProviderConfig"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      kind: string
      baseUrl: string | null
      apiKey: string | null
      defaultModel: string
      capabilities: string
      enabled: boolean
      createdAt: Date
    }, ExtArgs["result"]["providerConfig"]>
    composites: {}
  }

  type ProviderConfigGetPayload<S extends boolean | null | undefined | ProviderConfigDefaultArgs> = $Result.GetResult<Prisma.$ProviderConfigPayload, S>

  type ProviderConfigCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ProviderConfigFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ProviderConfigCountAggregateInputType | true
    }

  export interface ProviderConfigDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ProviderConfig'], meta: { name: 'ProviderConfig' } }
    /**
     * Find zero or one ProviderConfig that matches the filter.
     * @param {ProviderConfigFindUniqueArgs} args - Arguments to find a ProviderConfig
     * @example
     * // Get one ProviderConfig
     * const providerConfig = await prisma.providerConfig.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ProviderConfigFindUniqueArgs>(args: SelectSubset<T, ProviderConfigFindUniqueArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one ProviderConfig that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {ProviderConfigFindUniqueOrThrowArgs} args - Arguments to find a ProviderConfig
     * @example
     * // Get one ProviderConfig
     * const providerConfig = await prisma.providerConfig.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ProviderConfigFindUniqueOrThrowArgs>(args: SelectSubset<T, ProviderConfigFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first ProviderConfig that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigFindFirstArgs} args - Arguments to find a ProviderConfig
     * @example
     * // Get one ProviderConfig
     * const providerConfig = await prisma.providerConfig.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ProviderConfigFindFirstArgs>(args?: SelectSubset<T, ProviderConfigFindFirstArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first ProviderConfig that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigFindFirstOrThrowArgs} args - Arguments to find a ProviderConfig
     * @example
     * // Get one ProviderConfig
     * const providerConfig = await prisma.providerConfig.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ProviderConfigFindFirstOrThrowArgs>(args?: SelectSubset<T, ProviderConfigFindFirstOrThrowArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more ProviderConfigs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ProviderConfigs
     * const providerConfigs = await prisma.providerConfig.findMany()
     * 
     * // Get first 10 ProviderConfigs
     * const providerConfigs = await prisma.providerConfig.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const providerConfigWithIdOnly = await prisma.providerConfig.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ProviderConfigFindManyArgs>(args?: SelectSubset<T, ProviderConfigFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a ProviderConfig.
     * @param {ProviderConfigCreateArgs} args - Arguments to create a ProviderConfig.
     * @example
     * // Create one ProviderConfig
     * const ProviderConfig = await prisma.providerConfig.create({
     *   data: {
     *     // ... data to create a ProviderConfig
     *   }
     * })
     * 
     */
    create<T extends ProviderConfigCreateArgs>(args: SelectSubset<T, ProviderConfigCreateArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many ProviderConfigs.
     * @param {ProviderConfigCreateManyArgs} args - Arguments to create many ProviderConfigs.
     * @example
     * // Create many ProviderConfigs
     * const providerConfig = await prisma.providerConfig.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ProviderConfigCreateManyArgs>(args?: SelectSubset<T, ProviderConfigCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ProviderConfigs and returns the data saved in the database.
     * @param {ProviderConfigCreateManyAndReturnArgs} args - Arguments to create many ProviderConfigs.
     * @example
     * // Create many ProviderConfigs
     * const providerConfig = await prisma.providerConfig.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ProviderConfigs and only return the `id`
     * const providerConfigWithIdOnly = await prisma.providerConfig.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ProviderConfigCreateManyAndReturnArgs>(args?: SelectSubset<T, ProviderConfigCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a ProviderConfig.
     * @param {ProviderConfigDeleteArgs} args - Arguments to delete one ProviderConfig.
     * @example
     * // Delete one ProviderConfig
     * const ProviderConfig = await prisma.providerConfig.delete({
     *   where: {
     *     // ... filter to delete one ProviderConfig
     *   }
     * })
     * 
     */
    delete<T extends ProviderConfigDeleteArgs>(args: SelectSubset<T, ProviderConfigDeleteArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one ProviderConfig.
     * @param {ProviderConfigUpdateArgs} args - Arguments to update one ProviderConfig.
     * @example
     * // Update one ProviderConfig
     * const providerConfig = await prisma.providerConfig.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ProviderConfigUpdateArgs>(args: SelectSubset<T, ProviderConfigUpdateArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more ProviderConfigs.
     * @param {ProviderConfigDeleteManyArgs} args - Arguments to filter ProviderConfigs to delete.
     * @example
     * // Delete a few ProviderConfigs
     * const { count } = await prisma.providerConfig.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ProviderConfigDeleteManyArgs>(args?: SelectSubset<T, ProviderConfigDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ProviderConfigs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ProviderConfigs
     * const providerConfig = await prisma.providerConfig.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ProviderConfigUpdateManyArgs>(args: SelectSubset<T, ProviderConfigUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one ProviderConfig.
     * @param {ProviderConfigUpsertArgs} args - Arguments to update or create a ProviderConfig.
     * @example
     * // Update or create a ProviderConfig
     * const providerConfig = await prisma.providerConfig.upsert({
     *   create: {
     *     // ... data to create a ProviderConfig
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ProviderConfig we want to update
     *   }
     * })
     */
    upsert<T extends ProviderConfigUpsertArgs>(args: SelectSubset<T, ProviderConfigUpsertArgs<ExtArgs>>): Prisma__ProviderConfigClient<$Result.GetResult<Prisma.$ProviderConfigPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of ProviderConfigs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigCountArgs} args - Arguments to filter ProviderConfigs to count.
     * @example
     * // Count the number of ProviderConfigs
     * const count = await prisma.providerConfig.count({
     *   where: {
     *     // ... the filter for the ProviderConfigs we want to count
     *   }
     * })
    **/
    count<T extends ProviderConfigCountArgs>(
      args?: Subset<T, ProviderConfigCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ProviderConfigCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ProviderConfig.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ProviderConfigAggregateArgs>(args: Subset<T, ProviderConfigAggregateArgs>): Prisma.PrismaPromise<GetProviderConfigAggregateType<T>>

    /**
     * Group by ProviderConfig.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProviderConfigGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ProviderConfigGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ProviderConfigGroupByArgs['orderBy'] }
        : { orderBy?: ProviderConfigGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ProviderConfigGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProviderConfigGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ProviderConfig model
   */
  readonly fields: ProviderConfigFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ProviderConfig.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ProviderConfigClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the ProviderConfig model
   */ 
  interface ProviderConfigFieldRefs {
    readonly id: FieldRef<"ProviderConfig", 'String'>
    readonly name: FieldRef<"ProviderConfig", 'String'>
    readonly kind: FieldRef<"ProviderConfig", 'String'>
    readonly baseUrl: FieldRef<"ProviderConfig", 'String'>
    readonly apiKey: FieldRef<"ProviderConfig", 'String'>
    readonly defaultModel: FieldRef<"ProviderConfig", 'String'>
    readonly capabilities: FieldRef<"ProviderConfig", 'String'>
    readonly enabled: FieldRef<"ProviderConfig", 'Boolean'>
    readonly createdAt: FieldRef<"ProviderConfig", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * ProviderConfig findUnique
   */
  export type ProviderConfigFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * Filter, which ProviderConfig to fetch.
     */
    where: ProviderConfigWhereUniqueInput
  }

  /**
   * ProviderConfig findUniqueOrThrow
   */
  export type ProviderConfigFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * Filter, which ProviderConfig to fetch.
     */
    where: ProviderConfigWhereUniqueInput
  }

  /**
   * ProviderConfig findFirst
   */
  export type ProviderConfigFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * Filter, which ProviderConfig to fetch.
     */
    where?: ProviderConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProviderConfigs to fetch.
     */
    orderBy?: ProviderConfigOrderByWithRelationInput | ProviderConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ProviderConfigs.
     */
    cursor?: ProviderConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProviderConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProviderConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ProviderConfigs.
     */
    distinct?: ProviderConfigScalarFieldEnum | ProviderConfigScalarFieldEnum[]
  }

  /**
   * ProviderConfig findFirstOrThrow
   */
  export type ProviderConfigFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * Filter, which ProviderConfig to fetch.
     */
    where?: ProviderConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProviderConfigs to fetch.
     */
    orderBy?: ProviderConfigOrderByWithRelationInput | ProviderConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ProviderConfigs.
     */
    cursor?: ProviderConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProviderConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProviderConfigs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ProviderConfigs.
     */
    distinct?: ProviderConfigScalarFieldEnum | ProviderConfigScalarFieldEnum[]
  }

  /**
   * ProviderConfig findMany
   */
  export type ProviderConfigFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * Filter, which ProviderConfigs to fetch.
     */
    where?: ProviderConfigWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProviderConfigs to fetch.
     */
    orderBy?: ProviderConfigOrderByWithRelationInput | ProviderConfigOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ProviderConfigs.
     */
    cursor?: ProviderConfigWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProviderConfigs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProviderConfigs.
     */
    skip?: number
    distinct?: ProviderConfigScalarFieldEnum | ProviderConfigScalarFieldEnum[]
  }

  /**
   * ProviderConfig create
   */
  export type ProviderConfigCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * The data needed to create a ProviderConfig.
     */
    data: XOR<ProviderConfigCreateInput, ProviderConfigUncheckedCreateInput>
  }

  /**
   * ProviderConfig createMany
   */
  export type ProviderConfigCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ProviderConfigs.
     */
    data: ProviderConfigCreateManyInput | ProviderConfigCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ProviderConfig createManyAndReturn
   */
  export type ProviderConfigCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many ProviderConfigs.
     */
    data: ProviderConfigCreateManyInput | ProviderConfigCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ProviderConfig update
   */
  export type ProviderConfigUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * The data needed to update a ProviderConfig.
     */
    data: XOR<ProviderConfigUpdateInput, ProviderConfigUncheckedUpdateInput>
    /**
     * Choose, which ProviderConfig to update.
     */
    where: ProviderConfigWhereUniqueInput
  }

  /**
   * ProviderConfig updateMany
   */
  export type ProviderConfigUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ProviderConfigs.
     */
    data: XOR<ProviderConfigUpdateManyMutationInput, ProviderConfigUncheckedUpdateManyInput>
    /**
     * Filter which ProviderConfigs to update
     */
    where?: ProviderConfigWhereInput
  }

  /**
   * ProviderConfig upsert
   */
  export type ProviderConfigUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * The filter to search for the ProviderConfig to update in case it exists.
     */
    where: ProviderConfigWhereUniqueInput
    /**
     * In case the ProviderConfig found by the `where` argument doesn't exist, create a new ProviderConfig with this data.
     */
    create: XOR<ProviderConfigCreateInput, ProviderConfigUncheckedCreateInput>
    /**
     * In case the ProviderConfig was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ProviderConfigUpdateInput, ProviderConfigUncheckedUpdateInput>
  }

  /**
   * ProviderConfig delete
   */
  export type ProviderConfigDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
    /**
     * Filter which ProviderConfig to delete.
     */
    where: ProviderConfigWhereUniqueInput
  }

  /**
   * ProviderConfig deleteMany
   */
  export type ProviderConfigDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ProviderConfigs to delete
     */
    where?: ProviderConfigWhereInput
  }

  /**
   * ProviderConfig without action
   */
  export type ProviderConfigDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProviderConfig
     */
    select?: ProviderConfigSelect<ExtArgs> | null
  }


  /**
   * Model SkillArtifact
   */

  export type AggregateSkillArtifact = {
    _count: SkillArtifactCountAggregateOutputType | null
    _min: SkillArtifactMinAggregateOutputType | null
    _max: SkillArtifactMaxAggregateOutputType | null
  }

  export type SkillArtifactMinAggregateOutputType = {
    id: string | null
    name: string | null
    sourcePath: string | null
    generatedPath: string | null
    manifest: string | null
    registeredAt: Date | null
  }

  export type SkillArtifactMaxAggregateOutputType = {
    id: string | null
    name: string | null
    sourcePath: string | null
    generatedPath: string | null
    manifest: string | null
    registeredAt: Date | null
  }

  export type SkillArtifactCountAggregateOutputType = {
    id: number
    name: number
    sourcePath: number
    generatedPath: number
    manifest: number
    registeredAt: number
    _all: number
  }


  export type SkillArtifactMinAggregateInputType = {
    id?: true
    name?: true
    sourcePath?: true
    generatedPath?: true
    manifest?: true
    registeredAt?: true
  }

  export type SkillArtifactMaxAggregateInputType = {
    id?: true
    name?: true
    sourcePath?: true
    generatedPath?: true
    manifest?: true
    registeredAt?: true
  }

  export type SkillArtifactCountAggregateInputType = {
    id?: true
    name?: true
    sourcePath?: true
    generatedPath?: true
    manifest?: true
    registeredAt?: true
    _all?: true
  }

  export type SkillArtifactAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SkillArtifact to aggregate.
     */
    where?: SkillArtifactWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SkillArtifacts to fetch.
     */
    orderBy?: SkillArtifactOrderByWithRelationInput | SkillArtifactOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SkillArtifactWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SkillArtifacts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SkillArtifacts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned SkillArtifacts
    **/
    _count?: true | SkillArtifactCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SkillArtifactMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SkillArtifactMaxAggregateInputType
  }

  export type GetSkillArtifactAggregateType<T extends SkillArtifactAggregateArgs> = {
        [P in keyof T & keyof AggregateSkillArtifact]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSkillArtifact[P]>
      : GetScalarType<T[P], AggregateSkillArtifact[P]>
  }




  export type SkillArtifactGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SkillArtifactWhereInput
    orderBy?: SkillArtifactOrderByWithAggregationInput | SkillArtifactOrderByWithAggregationInput[]
    by: SkillArtifactScalarFieldEnum[] | SkillArtifactScalarFieldEnum
    having?: SkillArtifactScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SkillArtifactCountAggregateInputType | true
    _min?: SkillArtifactMinAggregateInputType
    _max?: SkillArtifactMaxAggregateInputType
  }

  export type SkillArtifactGroupByOutputType = {
    id: string
    name: string
    sourcePath: string
    generatedPath: string
    manifest: string
    registeredAt: Date
    _count: SkillArtifactCountAggregateOutputType | null
    _min: SkillArtifactMinAggregateOutputType | null
    _max: SkillArtifactMaxAggregateOutputType | null
  }

  type GetSkillArtifactGroupByPayload<T extends SkillArtifactGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SkillArtifactGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SkillArtifactGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SkillArtifactGroupByOutputType[P]>
            : GetScalarType<T[P], SkillArtifactGroupByOutputType[P]>
        }
      >
    >


  export type SkillArtifactSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    sourcePath?: boolean
    generatedPath?: boolean
    manifest?: boolean
    registeredAt?: boolean
  }, ExtArgs["result"]["skillArtifact"]>

  export type SkillArtifactSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    sourcePath?: boolean
    generatedPath?: boolean
    manifest?: boolean
    registeredAt?: boolean
  }, ExtArgs["result"]["skillArtifact"]>

  export type SkillArtifactSelectScalar = {
    id?: boolean
    name?: boolean
    sourcePath?: boolean
    generatedPath?: boolean
    manifest?: boolean
    registeredAt?: boolean
  }


  export type $SkillArtifactPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "SkillArtifact"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      sourcePath: string
      generatedPath: string
      manifest: string
      registeredAt: Date
    }, ExtArgs["result"]["skillArtifact"]>
    composites: {}
  }

  type SkillArtifactGetPayload<S extends boolean | null | undefined | SkillArtifactDefaultArgs> = $Result.GetResult<Prisma.$SkillArtifactPayload, S>

  type SkillArtifactCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<SkillArtifactFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: SkillArtifactCountAggregateInputType | true
    }

  export interface SkillArtifactDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['SkillArtifact'], meta: { name: 'SkillArtifact' } }
    /**
     * Find zero or one SkillArtifact that matches the filter.
     * @param {SkillArtifactFindUniqueArgs} args - Arguments to find a SkillArtifact
     * @example
     * // Get one SkillArtifact
     * const skillArtifact = await prisma.skillArtifact.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SkillArtifactFindUniqueArgs>(args: SelectSubset<T, SkillArtifactFindUniqueArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one SkillArtifact that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {SkillArtifactFindUniqueOrThrowArgs} args - Arguments to find a SkillArtifact
     * @example
     * // Get one SkillArtifact
     * const skillArtifact = await prisma.skillArtifact.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SkillArtifactFindUniqueOrThrowArgs>(args: SelectSubset<T, SkillArtifactFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first SkillArtifact that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactFindFirstArgs} args - Arguments to find a SkillArtifact
     * @example
     * // Get one SkillArtifact
     * const skillArtifact = await prisma.skillArtifact.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SkillArtifactFindFirstArgs>(args?: SelectSubset<T, SkillArtifactFindFirstArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first SkillArtifact that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactFindFirstOrThrowArgs} args - Arguments to find a SkillArtifact
     * @example
     * // Get one SkillArtifact
     * const skillArtifact = await prisma.skillArtifact.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SkillArtifactFindFirstOrThrowArgs>(args?: SelectSubset<T, SkillArtifactFindFirstOrThrowArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more SkillArtifacts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all SkillArtifacts
     * const skillArtifacts = await prisma.skillArtifact.findMany()
     * 
     * // Get first 10 SkillArtifacts
     * const skillArtifacts = await prisma.skillArtifact.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const skillArtifactWithIdOnly = await prisma.skillArtifact.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends SkillArtifactFindManyArgs>(args?: SelectSubset<T, SkillArtifactFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a SkillArtifact.
     * @param {SkillArtifactCreateArgs} args - Arguments to create a SkillArtifact.
     * @example
     * // Create one SkillArtifact
     * const SkillArtifact = await prisma.skillArtifact.create({
     *   data: {
     *     // ... data to create a SkillArtifact
     *   }
     * })
     * 
     */
    create<T extends SkillArtifactCreateArgs>(args: SelectSubset<T, SkillArtifactCreateArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many SkillArtifacts.
     * @param {SkillArtifactCreateManyArgs} args - Arguments to create many SkillArtifacts.
     * @example
     * // Create many SkillArtifacts
     * const skillArtifact = await prisma.skillArtifact.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SkillArtifactCreateManyArgs>(args?: SelectSubset<T, SkillArtifactCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many SkillArtifacts and returns the data saved in the database.
     * @param {SkillArtifactCreateManyAndReturnArgs} args - Arguments to create many SkillArtifacts.
     * @example
     * // Create many SkillArtifacts
     * const skillArtifact = await prisma.skillArtifact.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many SkillArtifacts and only return the `id`
     * const skillArtifactWithIdOnly = await prisma.skillArtifact.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SkillArtifactCreateManyAndReturnArgs>(args?: SelectSubset<T, SkillArtifactCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a SkillArtifact.
     * @param {SkillArtifactDeleteArgs} args - Arguments to delete one SkillArtifact.
     * @example
     * // Delete one SkillArtifact
     * const SkillArtifact = await prisma.skillArtifact.delete({
     *   where: {
     *     // ... filter to delete one SkillArtifact
     *   }
     * })
     * 
     */
    delete<T extends SkillArtifactDeleteArgs>(args: SelectSubset<T, SkillArtifactDeleteArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one SkillArtifact.
     * @param {SkillArtifactUpdateArgs} args - Arguments to update one SkillArtifact.
     * @example
     * // Update one SkillArtifact
     * const skillArtifact = await prisma.skillArtifact.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SkillArtifactUpdateArgs>(args: SelectSubset<T, SkillArtifactUpdateArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more SkillArtifacts.
     * @param {SkillArtifactDeleteManyArgs} args - Arguments to filter SkillArtifacts to delete.
     * @example
     * // Delete a few SkillArtifacts
     * const { count } = await prisma.skillArtifact.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SkillArtifactDeleteManyArgs>(args?: SelectSubset<T, SkillArtifactDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SkillArtifacts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many SkillArtifacts
     * const skillArtifact = await prisma.skillArtifact.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SkillArtifactUpdateManyArgs>(args: SelectSubset<T, SkillArtifactUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one SkillArtifact.
     * @param {SkillArtifactUpsertArgs} args - Arguments to update or create a SkillArtifact.
     * @example
     * // Update or create a SkillArtifact
     * const skillArtifact = await prisma.skillArtifact.upsert({
     *   create: {
     *     // ... data to create a SkillArtifact
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the SkillArtifact we want to update
     *   }
     * })
     */
    upsert<T extends SkillArtifactUpsertArgs>(args: SelectSubset<T, SkillArtifactUpsertArgs<ExtArgs>>): Prisma__SkillArtifactClient<$Result.GetResult<Prisma.$SkillArtifactPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of SkillArtifacts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactCountArgs} args - Arguments to filter SkillArtifacts to count.
     * @example
     * // Count the number of SkillArtifacts
     * const count = await prisma.skillArtifact.count({
     *   where: {
     *     // ... the filter for the SkillArtifacts we want to count
     *   }
     * })
    **/
    count<T extends SkillArtifactCountArgs>(
      args?: Subset<T, SkillArtifactCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SkillArtifactCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a SkillArtifact.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SkillArtifactAggregateArgs>(args: Subset<T, SkillArtifactAggregateArgs>): Prisma.PrismaPromise<GetSkillArtifactAggregateType<T>>

    /**
     * Group by SkillArtifact.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SkillArtifactGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SkillArtifactGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SkillArtifactGroupByArgs['orderBy'] }
        : { orderBy?: SkillArtifactGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SkillArtifactGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSkillArtifactGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the SkillArtifact model
   */
  readonly fields: SkillArtifactFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for SkillArtifact.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SkillArtifactClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the SkillArtifact model
   */ 
  interface SkillArtifactFieldRefs {
    readonly id: FieldRef<"SkillArtifact", 'String'>
    readonly name: FieldRef<"SkillArtifact", 'String'>
    readonly sourcePath: FieldRef<"SkillArtifact", 'String'>
    readonly generatedPath: FieldRef<"SkillArtifact", 'String'>
    readonly manifest: FieldRef<"SkillArtifact", 'String'>
    readonly registeredAt: FieldRef<"SkillArtifact", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * SkillArtifact findUnique
   */
  export type SkillArtifactFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * Filter, which SkillArtifact to fetch.
     */
    where: SkillArtifactWhereUniqueInput
  }

  /**
   * SkillArtifact findUniqueOrThrow
   */
  export type SkillArtifactFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * Filter, which SkillArtifact to fetch.
     */
    where: SkillArtifactWhereUniqueInput
  }

  /**
   * SkillArtifact findFirst
   */
  export type SkillArtifactFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * Filter, which SkillArtifact to fetch.
     */
    where?: SkillArtifactWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SkillArtifacts to fetch.
     */
    orderBy?: SkillArtifactOrderByWithRelationInput | SkillArtifactOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SkillArtifacts.
     */
    cursor?: SkillArtifactWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SkillArtifacts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SkillArtifacts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SkillArtifacts.
     */
    distinct?: SkillArtifactScalarFieldEnum | SkillArtifactScalarFieldEnum[]
  }

  /**
   * SkillArtifact findFirstOrThrow
   */
  export type SkillArtifactFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * Filter, which SkillArtifact to fetch.
     */
    where?: SkillArtifactWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SkillArtifacts to fetch.
     */
    orderBy?: SkillArtifactOrderByWithRelationInput | SkillArtifactOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SkillArtifacts.
     */
    cursor?: SkillArtifactWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SkillArtifacts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SkillArtifacts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SkillArtifacts.
     */
    distinct?: SkillArtifactScalarFieldEnum | SkillArtifactScalarFieldEnum[]
  }

  /**
   * SkillArtifact findMany
   */
  export type SkillArtifactFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * Filter, which SkillArtifacts to fetch.
     */
    where?: SkillArtifactWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SkillArtifacts to fetch.
     */
    orderBy?: SkillArtifactOrderByWithRelationInput | SkillArtifactOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing SkillArtifacts.
     */
    cursor?: SkillArtifactWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SkillArtifacts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SkillArtifacts.
     */
    skip?: number
    distinct?: SkillArtifactScalarFieldEnum | SkillArtifactScalarFieldEnum[]
  }

  /**
   * SkillArtifact create
   */
  export type SkillArtifactCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * The data needed to create a SkillArtifact.
     */
    data: XOR<SkillArtifactCreateInput, SkillArtifactUncheckedCreateInput>
  }

  /**
   * SkillArtifact createMany
   */
  export type SkillArtifactCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many SkillArtifacts.
     */
    data: SkillArtifactCreateManyInput | SkillArtifactCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SkillArtifact createManyAndReturn
   */
  export type SkillArtifactCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many SkillArtifacts.
     */
    data: SkillArtifactCreateManyInput | SkillArtifactCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SkillArtifact update
   */
  export type SkillArtifactUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * The data needed to update a SkillArtifact.
     */
    data: XOR<SkillArtifactUpdateInput, SkillArtifactUncheckedUpdateInput>
    /**
     * Choose, which SkillArtifact to update.
     */
    where: SkillArtifactWhereUniqueInput
  }

  /**
   * SkillArtifact updateMany
   */
  export type SkillArtifactUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update SkillArtifacts.
     */
    data: XOR<SkillArtifactUpdateManyMutationInput, SkillArtifactUncheckedUpdateManyInput>
    /**
     * Filter which SkillArtifacts to update
     */
    where?: SkillArtifactWhereInput
  }

  /**
   * SkillArtifact upsert
   */
  export type SkillArtifactUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * The filter to search for the SkillArtifact to update in case it exists.
     */
    where: SkillArtifactWhereUniqueInput
    /**
     * In case the SkillArtifact found by the `where` argument doesn't exist, create a new SkillArtifact with this data.
     */
    create: XOR<SkillArtifactCreateInput, SkillArtifactUncheckedCreateInput>
    /**
     * In case the SkillArtifact was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SkillArtifactUpdateInput, SkillArtifactUncheckedUpdateInput>
  }

  /**
   * SkillArtifact delete
   */
  export type SkillArtifactDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
    /**
     * Filter which SkillArtifact to delete.
     */
    where: SkillArtifactWhereUniqueInput
  }

  /**
   * SkillArtifact deleteMany
   */
  export type SkillArtifactDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SkillArtifacts to delete
     */
    where?: SkillArtifactWhereInput
  }

  /**
   * SkillArtifact without action
   */
  export type SkillArtifactDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SkillArtifact
     */
    select?: SkillArtifactSelect<ExtArgs> | null
  }


  /**
   * Model PromptVersion
   */

  export type AggregatePromptVersion = {
    _count: PromptVersionCountAggregateOutputType | null
    _min: PromptVersionMinAggregateOutputType | null
    _max: PromptVersionMaxAggregateOutputType | null
  }

  export type PromptVersionMinAggregateOutputType = {
    id: string | null
    name: string | null
    sourcePath: string | null
    systemPrompt: string | null
    textToolsPrompt: string | null
    hash: string | null
    metadata: string | null
    createdAt: Date | null
  }

  export type PromptVersionMaxAggregateOutputType = {
    id: string | null
    name: string | null
    sourcePath: string | null
    systemPrompt: string | null
    textToolsPrompt: string | null
    hash: string | null
    metadata: string | null
    createdAt: Date | null
  }

  export type PromptVersionCountAggregateOutputType = {
    id: number
    name: number
    sourcePath: number
    systemPrompt: number
    textToolsPrompt: number
    hash: number
    metadata: number
    createdAt: number
    _all: number
  }


  export type PromptVersionMinAggregateInputType = {
    id?: true
    name?: true
    sourcePath?: true
    systemPrompt?: true
    textToolsPrompt?: true
    hash?: true
    metadata?: true
    createdAt?: true
  }

  export type PromptVersionMaxAggregateInputType = {
    id?: true
    name?: true
    sourcePath?: true
    systemPrompt?: true
    textToolsPrompt?: true
    hash?: true
    metadata?: true
    createdAt?: true
  }

  export type PromptVersionCountAggregateInputType = {
    id?: true
    name?: true
    sourcePath?: true
    systemPrompt?: true
    textToolsPrompt?: true
    hash?: true
    metadata?: true
    createdAt?: true
    _all?: true
  }

  export type PromptVersionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PromptVersion to aggregate.
     */
    where?: PromptVersionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PromptVersions to fetch.
     */
    orderBy?: PromptVersionOrderByWithRelationInput | PromptVersionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PromptVersionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PromptVersions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PromptVersions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PromptVersions
    **/
    _count?: true | PromptVersionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PromptVersionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PromptVersionMaxAggregateInputType
  }

  export type GetPromptVersionAggregateType<T extends PromptVersionAggregateArgs> = {
        [P in keyof T & keyof AggregatePromptVersion]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePromptVersion[P]>
      : GetScalarType<T[P], AggregatePromptVersion[P]>
  }




  export type PromptVersionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PromptVersionWhereInput
    orderBy?: PromptVersionOrderByWithAggregationInput | PromptVersionOrderByWithAggregationInput[]
    by: PromptVersionScalarFieldEnum[] | PromptVersionScalarFieldEnum
    having?: PromptVersionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PromptVersionCountAggregateInputType | true
    _min?: PromptVersionMinAggregateInputType
    _max?: PromptVersionMaxAggregateInputType
  }

  export type PromptVersionGroupByOutputType = {
    id: string
    name: string
    sourcePath: string
    systemPrompt: string
    textToolsPrompt: string
    hash: string
    metadata: string | null
    createdAt: Date
    _count: PromptVersionCountAggregateOutputType | null
    _min: PromptVersionMinAggregateOutputType | null
    _max: PromptVersionMaxAggregateOutputType | null
  }

  type GetPromptVersionGroupByPayload<T extends PromptVersionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PromptVersionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PromptVersionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PromptVersionGroupByOutputType[P]>
            : GetScalarType<T[P], PromptVersionGroupByOutputType[P]>
        }
      >
    >


  export type PromptVersionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    sourcePath?: boolean
    systemPrompt?: boolean
    textToolsPrompt?: boolean
    hash?: boolean
    metadata?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["promptVersion"]>

  export type PromptVersionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    sourcePath?: boolean
    systemPrompt?: boolean
    textToolsPrompt?: boolean
    hash?: boolean
    metadata?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["promptVersion"]>

  export type PromptVersionSelectScalar = {
    id?: boolean
    name?: boolean
    sourcePath?: boolean
    systemPrompt?: boolean
    textToolsPrompt?: boolean
    hash?: boolean
    metadata?: boolean
    createdAt?: boolean
  }


  export type $PromptVersionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PromptVersion"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      sourcePath: string
      systemPrompt: string
      textToolsPrompt: string
      hash: string
      metadata: string | null
      createdAt: Date
    }, ExtArgs["result"]["promptVersion"]>
    composites: {}
  }

  type PromptVersionGetPayload<S extends boolean | null | undefined | PromptVersionDefaultArgs> = $Result.GetResult<Prisma.$PromptVersionPayload, S>

  type PromptVersionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PromptVersionFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PromptVersionCountAggregateInputType | true
    }

  export interface PromptVersionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PromptVersion'], meta: { name: 'PromptVersion' } }
    /**
     * Find zero or one PromptVersion that matches the filter.
     * @param {PromptVersionFindUniqueArgs} args - Arguments to find a PromptVersion
     * @example
     * // Get one PromptVersion
     * const promptVersion = await prisma.promptVersion.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PromptVersionFindUniqueArgs>(args: SelectSubset<T, PromptVersionFindUniqueArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one PromptVersion that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {PromptVersionFindUniqueOrThrowArgs} args - Arguments to find a PromptVersion
     * @example
     * // Get one PromptVersion
     * const promptVersion = await prisma.promptVersion.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PromptVersionFindUniqueOrThrowArgs>(args: SelectSubset<T, PromptVersionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first PromptVersion that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionFindFirstArgs} args - Arguments to find a PromptVersion
     * @example
     * // Get one PromptVersion
     * const promptVersion = await prisma.promptVersion.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PromptVersionFindFirstArgs>(args?: SelectSubset<T, PromptVersionFindFirstArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first PromptVersion that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionFindFirstOrThrowArgs} args - Arguments to find a PromptVersion
     * @example
     * // Get one PromptVersion
     * const promptVersion = await prisma.promptVersion.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PromptVersionFindFirstOrThrowArgs>(args?: SelectSubset<T, PromptVersionFindFirstOrThrowArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more PromptVersions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PromptVersions
     * const promptVersions = await prisma.promptVersion.findMany()
     * 
     * // Get first 10 PromptVersions
     * const promptVersions = await prisma.promptVersion.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const promptVersionWithIdOnly = await prisma.promptVersion.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PromptVersionFindManyArgs>(args?: SelectSubset<T, PromptVersionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a PromptVersion.
     * @param {PromptVersionCreateArgs} args - Arguments to create a PromptVersion.
     * @example
     * // Create one PromptVersion
     * const PromptVersion = await prisma.promptVersion.create({
     *   data: {
     *     // ... data to create a PromptVersion
     *   }
     * })
     * 
     */
    create<T extends PromptVersionCreateArgs>(args: SelectSubset<T, PromptVersionCreateArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many PromptVersions.
     * @param {PromptVersionCreateManyArgs} args - Arguments to create many PromptVersions.
     * @example
     * // Create many PromptVersions
     * const promptVersion = await prisma.promptVersion.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PromptVersionCreateManyArgs>(args?: SelectSubset<T, PromptVersionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PromptVersions and returns the data saved in the database.
     * @param {PromptVersionCreateManyAndReturnArgs} args - Arguments to create many PromptVersions.
     * @example
     * // Create many PromptVersions
     * const promptVersion = await prisma.promptVersion.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PromptVersions and only return the `id`
     * const promptVersionWithIdOnly = await prisma.promptVersion.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PromptVersionCreateManyAndReturnArgs>(args?: SelectSubset<T, PromptVersionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a PromptVersion.
     * @param {PromptVersionDeleteArgs} args - Arguments to delete one PromptVersion.
     * @example
     * // Delete one PromptVersion
     * const PromptVersion = await prisma.promptVersion.delete({
     *   where: {
     *     // ... filter to delete one PromptVersion
     *   }
     * })
     * 
     */
    delete<T extends PromptVersionDeleteArgs>(args: SelectSubset<T, PromptVersionDeleteArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one PromptVersion.
     * @param {PromptVersionUpdateArgs} args - Arguments to update one PromptVersion.
     * @example
     * // Update one PromptVersion
     * const promptVersion = await prisma.promptVersion.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PromptVersionUpdateArgs>(args: SelectSubset<T, PromptVersionUpdateArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more PromptVersions.
     * @param {PromptVersionDeleteManyArgs} args - Arguments to filter PromptVersions to delete.
     * @example
     * // Delete a few PromptVersions
     * const { count } = await prisma.promptVersion.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PromptVersionDeleteManyArgs>(args?: SelectSubset<T, PromptVersionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PromptVersions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PromptVersions
     * const promptVersion = await prisma.promptVersion.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PromptVersionUpdateManyArgs>(args: SelectSubset<T, PromptVersionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PromptVersion.
     * @param {PromptVersionUpsertArgs} args - Arguments to update or create a PromptVersion.
     * @example
     * // Update or create a PromptVersion
     * const promptVersion = await prisma.promptVersion.upsert({
     *   create: {
     *     // ... data to create a PromptVersion
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PromptVersion we want to update
     *   }
     * })
     */
    upsert<T extends PromptVersionUpsertArgs>(args: SelectSubset<T, PromptVersionUpsertArgs<ExtArgs>>): Prisma__PromptVersionClient<$Result.GetResult<Prisma.$PromptVersionPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of PromptVersions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionCountArgs} args - Arguments to filter PromptVersions to count.
     * @example
     * // Count the number of PromptVersions
     * const count = await prisma.promptVersion.count({
     *   where: {
     *     // ... the filter for the PromptVersions we want to count
     *   }
     * })
    **/
    count<T extends PromptVersionCountArgs>(
      args?: Subset<T, PromptVersionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PromptVersionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PromptVersion.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PromptVersionAggregateArgs>(args: Subset<T, PromptVersionAggregateArgs>): Prisma.PrismaPromise<GetPromptVersionAggregateType<T>>

    /**
     * Group by PromptVersion.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PromptVersionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PromptVersionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PromptVersionGroupByArgs['orderBy'] }
        : { orderBy?: PromptVersionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PromptVersionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPromptVersionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PromptVersion model
   */
  readonly fields: PromptVersionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PromptVersion.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PromptVersionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PromptVersion model
   */ 
  interface PromptVersionFieldRefs {
    readonly id: FieldRef<"PromptVersion", 'String'>
    readonly name: FieldRef<"PromptVersion", 'String'>
    readonly sourcePath: FieldRef<"PromptVersion", 'String'>
    readonly systemPrompt: FieldRef<"PromptVersion", 'String'>
    readonly textToolsPrompt: FieldRef<"PromptVersion", 'String'>
    readonly hash: FieldRef<"PromptVersion", 'String'>
    readonly metadata: FieldRef<"PromptVersion", 'String'>
    readonly createdAt: FieldRef<"PromptVersion", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PromptVersion findUnique
   */
  export type PromptVersionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * Filter, which PromptVersion to fetch.
     */
    where: PromptVersionWhereUniqueInput
  }

  /**
   * PromptVersion findUniqueOrThrow
   */
  export type PromptVersionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * Filter, which PromptVersion to fetch.
     */
    where: PromptVersionWhereUniqueInput
  }

  /**
   * PromptVersion findFirst
   */
  export type PromptVersionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * Filter, which PromptVersion to fetch.
     */
    where?: PromptVersionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PromptVersions to fetch.
     */
    orderBy?: PromptVersionOrderByWithRelationInput | PromptVersionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PromptVersions.
     */
    cursor?: PromptVersionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PromptVersions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PromptVersions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PromptVersions.
     */
    distinct?: PromptVersionScalarFieldEnum | PromptVersionScalarFieldEnum[]
  }

  /**
   * PromptVersion findFirstOrThrow
   */
  export type PromptVersionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * Filter, which PromptVersion to fetch.
     */
    where?: PromptVersionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PromptVersions to fetch.
     */
    orderBy?: PromptVersionOrderByWithRelationInput | PromptVersionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PromptVersions.
     */
    cursor?: PromptVersionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PromptVersions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PromptVersions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PromptVersions.
     */
    distinct?: PromptVersionScalarFieldEnum | PromptVersionScalarFieldEnum[]
  }

  /**
   * PromptVersion findMany
   */
  export type PromptVersionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * Filter, which PromptVersions to fetch.
     */
    where?: PromptVersionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PromptVersions to fetch.
     */
    orderBy?: PromptVersionOrderByWithRelationInput | PromptVersionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PromptVersions.
     */
    cursor?: PromptVersionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PromptVersions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PromptVersions.
     */
    skip?: number
    distinct?: PromptVersionScalarFieldEnum | PromptVersionScalarFieldEnum[]
  }

  /**
   * PromptVersion create
   */
  export type PromptVersionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * The data needed to create a PromptVersion.
     */
    data: XOR<PromptVersionCreateInput, PromptVersionUncheckedCreateInput>
  }

  /**
   * PromptVersion createMany
   */
  export type PromptVersionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PromptVersions.
     */
    data: PromptVersionCreateManyInput | PromptVersionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PromptVersion createManyAndReturn
   */
  export type PromptVersionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many PromptVersions.
     */
    data: PromptVersionCreateManyInput | PromptVersionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PromptVersion update
   */
  export type PromptVersionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * The data needed to update a PromptVersion.
     */
    data: XOR<PromptVersionUpdateInput, PromptVersionUncheckedUpdateInput>
    /**
     * Choose, which PromptVersion to update.
     */
    where: PromptVersionWhereUniqueInput
  }

  /**
   * PromptVersion updateMany
   */
  export type PromptVersionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PromptVersions.
     */
    data: XOR<PromptVersionUpdateManyMutationInput, PromptVersionUncheckedUpdateManyInput>
    /**
     * Filter which PromptVersions to update
     */
    where?: PromptVersionWhereInput
  }

  /**
   * PromptVersion upsert
   */
  export type PromptVersionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * The filter to search for the PromptVersion to update in case it exists.
     */
    where: PromptVersionWhereUniqueInput
    /**
     * In case the PromptVersion found by the `where` argument doesn't exist, create a new PromptVersion with this data.
     */
    create: XOR<PromptVersionCreateInput, PromptVersionUncheckedCreateInput>
    /**
     * In case the PromptVersion was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PromptVersionUpdateInput, PromptVersionUncheckedUpdateInput>
  }

  /**
   * PromptVersion delete
   */
  export type PromptVersionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
    /**
     * Filter which PromptVersion to delete.
     */
    where: PromptVersionWhereUniqueInput
  }

  /**
   * PromptVersion deleteMany
   */
  export type PromptVersionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PromptVersions to delete
     */
    where?: PromptVersionWhereInput
  }

  /**
   * PromptVersion without action
   */
  export type PromptVersionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PromptVersion
     */
    select?: PromptVersionSelect<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const ProjectScalarFieldEnum: {
    id: 'id',
    name: 'name',
    path: 'path',
    repoUrl: 'repoUrl',
    description: 'description',
    env: 'env',
    createdAt: 'createdAt'
  };

  export type ProjectScalarFieldEnum = (typeof ProjectScalarFieldEnum)[keyof typeof ProjectScalarFieldEnum]


  export const TaskScalarFieldEnum: {
    id: 'id',
    projectId: 'projectId',
    title: 'title',
    description: 'description',
    status: 'status',
    complexity: 'complexity',
    tags: 'tags',
    provider: 'provider',
    model: 'model',
    result: 'result',
    error: 'error',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TaskScalarFieldEnum = (typeof TaskScalarFieldEnum)[keyof typeof TaskScalarFieldEnum]


  export const TaskStepScalarFieldEnum: {
    id: 'id',
    taskId: 'taskId',
    idx: 'idx',
    name: 'name',
    status: 'status',
    input: 'input',
    output: 'output',
    error: 'error',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TaskStepScalarFieldEnum = (typeof TaskStepScalarFieldEnum)[keyof typeof TaskStepScalarFieldEnum]


  export const TaskTraceScalarFieldEnum: {
    id: 'id',
    taskId: 'taskId',
    stepId: 'stepId',
    role: 'role',
    content: 'content',
    toolCalls: 'toolCalls',
    createdAt: 'createdAt'
  };

  export type TaskTraceScalarFieldEnum = (typeof TaskTraceScalarFieldEnum)[keyof typeof TaskTraceScalarFieldEnum]


  export const TaskDiffScalarFieldEnum: {
    id: 'id',
    taskId: 'taskId',
    branch: 'branch',
    commitSha: 'commitSha',
    patch: 'patch',
    createdAt: 'createdAt'
  };

  export type TaskDiffScalarFieldEnum = (typeof TaskDiffScalarFieldEnum)[keyof typeof TaskDiffScalarFieldEnum]


  export const AgentRunScalarFieldEnum: {
    id: 'id',
    taskId: 'taskId',
    branch: 'branch',
    baseCommit: 'baseCommit',
    resultStatus: 'resultStatus',
    validationSummary: 'validationSummary',
    publishedVersion: 'publishedVersion',
    promptTokens: 'promptTokens',
    completionTokens: 'completionTokens',
    totalTokens: 'totalTokens',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type AgentRunScalarFieldEnum = (typeof AgentRunScalarFieldEnum)[keyof typeof AgentRunScalarFieldEnum]


  export const TraceSpanScalarFieldEnum: {
    id: 'id',
    traceId: 'traceId',
    spanId: 'spanId',
    parentId: 'parentId',
    taskId: 'taskId',
    name: 'name',
    startTime: 'startTime',
    endTime: 'endTime',
    status: 'status',
    attributes: 'attributes',
    events: 'events'
  };

  export type TraceSpanScalarFieldEnum = (typeof TraceSpanScalarFieldEnum)[keyof typeof TraceSpanScalarFieldEnum]


  export const ProviderConfigScalarFieldEnum: {
    id: 'id',
    name: 'name',
    kind: 'kind',
    baseUrl: 'baseUrl',
    apiKey: 'apiKey',
    defaultModel: 'defaultModel',
    capabilities: 'capabilities',
    enabled: 'enabled',
    createdAt: 'createdAt'
  };

  export type ProviderConfigScalarFieldEnum = (typeof ProviderConfigScalarFieldEnum)[keyof typeof ProviderConfigScalarFieldEnum]


  export const SkillArtifactScalarFieldEnum: {
    id: 'id',
    name: 'name',
    sourcePath: 'sourcePath',
    generatedPath: 'generatedPath',
    manifest: 'manifest',
    registeredAt: 'registeredAt'
  };

  export type SkillArtifactScalarFieldEnum = (typeof SkillArtifactScalarFieldEnum)[keyof typeof SkillArtifactScalarFieldEnum]


  export const PromptVersionScalarFieldEnum: {
    id: 'id',
    name: 'name',
    sourcePath: 'sourcePath',
    systemPrompt: 'systemPrompt',
    textToolsPrompt: 'textToolsPrompt',
    hash: 'hash',
    metadata: 'metadata',
    createdAt: 'createdAt'
  };

  export type PromptVersionScalarFieldEnum = (typeof PromptVersionScalarFieldEnum)[keyof typeof PromptVersionScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type ProjectWhereInput = {
    AND?: ProjectWhereInput | ProjectWhereInput[]
    OR?: ProjectWhereInput[]
    NOT?: ProjectWhereInput | ProjectWhereInput[]
    id?: StringFilter<"Project"> | string
    name?: StringFilter<"Project"> | string
    path?: StringFilter<"Project"> | string
    repoUrl?: StringNullableFilter<"Project"> | string | null
    description?: StringNullableFilter<"Project"> | string | null
    env?: StringNullableFilter<"Project"> | string | null
    createdAt?: DateTimeFilter<"Project"> | Date | string
    tasks?: TaskListRelationFilter
  }

  export type ProjectOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    path?: SortOrder
    repoUrl?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    env?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    tasks?: TaskOrderByRelationAggregateInput
  }

  export type ProjectWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    path?: string
    AND?: ProjectWhereInput | ProjectWhereInput[]
    OR?: ProjectWhereInput[]
    NOT?: ProjectWhereInput | ProjectWhereInput[]
    name?: StringFilter<"Project"> | string
    repoUrl?: StringNullableFilter<"Project"> | string | null
    description?: StringNullableFilter<"Project"> | string | null
    env?: StringNullableFilter<"Project"> | string | null
    createdAt?: DateTimeFilter<"Project"> | Date | string
    tasks?: TaskListRelationFilter
  }, "id" | "path">

  export type ProjectOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    path?: SortOrder
    repoUrl?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    env?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: ProjectCountOrderByAggregateInput
    _max?: ProjectMaxOrderByAggregateInput
    _min?: ProjectMinOrderByAggregateInput
  }

  export type ProjectScalarWhereWithAggregatesInput = {
    AND?: ProjectScalarWhereWithAggregatesInput | ProjectScalarWhereWithAggregatesInput[]
    OR?: ProjectScalarWhereWithAggregatesInput[]
    NOT?: ProjectScalarWhereWithAggregatesInput | ProjectScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Project"> | string
    name?: StringWithAggregatesFilter<"Project"> | string
    path?: StringWithAggregatesFilter<"Project"> | string
    repoUrl?: StringNullableWithAggregatesFilter<"Project"> | string | null
    description?: StringNullableWithAggregatesFilter<"Project"> | string | null
    env?: StringNullableWithAggregatesFilter<"Project"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Project"> | Date | string
  }

  export type TaskWhereInput = {
    AND?: TaskWhereInput | TaskWhereInput[]
    OR?: TaskWhereInput[]
    NOT?: TaskWhereInput | TaskWhereInput[]
    id?: StringFilter<"Task"> | string
    projectId?: StringFilter<"Task"> | string
    title?: StringFilter<"Task"> | string
    description?: StringNullableFilter<"Task"> | string | null
    status?: StringFilter<"Task"> | string
    complexity?: StringFilter<"Task"> | string
    tags?: StringNullableFilter<"Task"> | string | null
    provider?: StringNullableFilter<"Task"> | string | null
    model?: StringNullableFilter<"Task"> | string | null
    result?: StringNullableFilter<"Task"> | string | null
    error?: StringNullableFilter<"Task"> | string | null
    createdAt?: DateTimeFilter<"Task"> | Date | string
    updatedAt?: DateTimeFilter<"Task"> | Date | string
    project?: XOR<ProjectRelationFilter, ProjectWhereInput>
    steps?: TaskStepListRelationFilter
    traces?: TaskTraceListRelationFilter
    diffs?: TaskDiffListRelationFilter
    agentRuns?: AgentRunListRelationFilter
    traceSpans?: TraceSpanListRelationFilter
  }

  export type TaskOrderByWithRelationInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    status?: SortOrder
    complexity?: SortOrder
    tags?: SortOrderInput | SortOrder
    provider?: SortOrderInput | SortOrder
    model?: SortOrderInput | SortOrder
    result?: SortOrderInput | SortOrder
    error?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    project?: ProjectOrderByWithRelationInput
    steps?: TaskStepOrderByRelationAggregateInput
    traces?: TaskTraceOrderByRelationAggregateInput
    diffs?: TaskDiffOrderByRelationAggregateInput
    agentRuns?: AgentRunOrderByRelationAggregateInput
    traceSpans?: TraceSpanOrderByRelationAggregateInput
  }

  export type TaskWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TaskWhereInput | TaskWhereInput[]
    OR?: TaskWhereInput[]
    NOT?: TaskWhereInput | TaskWhereInput[]
    projectId?: StringFilter<"Task"> | string
    title?: StringFilter<"Task"> | string
    description?: StringNullableFilter<"Task"> | string | null
    status?: StringFilter<"Task"> | string
    complexity?: StringFilter<"Task"> | string
    tags?: StringNullableFilter<"Task"> | string | null
    provider?: StringNullableFilter<"Task"> | string | null
    model?: StringNullableFilter<"Task"> | string | null
    result?: StringNullableFilter<"Task"> | string | null
    error?: StringNullableFilter<"Task"> | string | null
    createdAt?: DateTimeFilter<"Task"> | Date | string
    updatedAt?: DateTimeFilter<"Task"> | Date | string
    project?: XOR<ProjectRelationFilter, ProjectWhereInput>
    steps?: TaskStepListRelationFilter
    traces?: TaskTraceListRelationFilter
    diffs?: TaskDiffListRelationFilter
    agentRuns?: AgentRunListRelationFilter
    traceSpans?: TraceSpanListRelationFilter
  }, "id">

  export type TaskOrderByWithAggregationInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    status?: SortOrder
    complexity?: SortOrder
    tags?: SortOrderInput | SortOrder
    provider?: SortOrderInput | SortOrder
    model?: SortOrderInput | SortOrder
    result?: SortOrderInput | SortOrder
    error?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TaskCountOrderByAggregateInput
    _max?: TaskMaxOrderByAggregateInput
    _min?: TaskMinOrderByAggregateInput
  }

  export type TaskScalarWhereWithAggregatesInput = {
    AND?: TaskScalarWhereWithAggregatesInput | TaskScalarWhereWithAggregatesInput[]
    OR?: TaskScalarWhereWithAggregatesInput[]
    NOT?: TaskScalarWhereWithAggregatesInput | TaskScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Task"> | string
    projectId?: StringWithAggregatesFilter<"Task"> | string
    title?: StringWithAggregatesFilter<"Task"> | string
    description?: StringNullableWithAggregatesFilter<"Task"> | string | null
    status?: StringWithAggregatesFilter<"Task"> | string
    complexity?: StringWithAggregatesFilter<"Task"> | string
    tags?: StringNullableWithAggregatesFilter<"Task"> | string | null
    provider?: StringNullableWithAggregatesFilter<"Task"> | string | null
    model?: StringNullableWithAggregatesFilter<"Task"> | string | null
    result?: StringNullableWithAggregatesFilter<"Task"> | string | null
    error?: StringNullableWithAggregatesFilter<"Task"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Task"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Task"> | Date | string
  }

  export type TaskStepWhereInput = {
    AND?: TaskStepWhereInput | TaskStepWhereInput[]
    OR?: TaskStepWhereInput[]
    NOT?: TaskStepWhereInput | TaskStepWhereInput[]
    id?: StringFilter<"TaskStep"> | string
    taskId?: StringFilter<"TaskStep"> | string
    idx?: IntFilter<"TaskStep"> | number
    name?: StringFilter<"TaskStep"> | string
    status?: StringFilter<"TaskStep"> | string
    input?: StringNullableFilter<"TaskStep"> | string | null
    output?: StringNullableFilter<"TaskStep"> | string | null
    error?: StringNullableFilter<"TaskStep"> | string | null
    createdAt?: DateTimeFilter<"TaskStep"> | Date | string
    updatedAt?: DateTimeFilter<"TaskStep"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }

  export type TaskStepOrderByWithRelationInput = {
    id?: SortOrder
    taskId?: SortOrder
    idx?: SortOrder
    name?: SortOrder
    status?: SortOrder
    input?: SortOrderInput | SortOrder
    output?: SortOrderInput | SortOrder
    error?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    task?: TaskOrderByWithRelationInput
  }

  export type TaskStepWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TaskStepWhereInput | TaskStepWhereInput[]
    OR?: TaskStepWhereInput[]
    NOT?: TaskStepWhereInput | TaskStepWhereInput[]
    taskId?: StringFilter<"TaskStep"> | string
    idx?: IntFilter<"TaskStep"> | number
    name?: StringFilter<"TaskStep"> | string
    status?: StringFilter<"TaskStep"> | string
    input?: StringNullableFilter<"TaskStep"> | string | null
    output?: StringNullableFilter<"TaskStep"> | string | null
    error?: StringNullableFilter<"TaskStep"> | string | null
    createdAt?: DateTimeFilter<"TaskStep"> | Date | string
    updatedAt?: DateTimeFilter<"TaskStep"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }, "id">

  export type TaskStepOrderByWithAggregationInput = {
    id?: SortOrder
    taskId?: SortOrder
    idx?: SortOrder
    name?: SortOrder
    status?: SortOrder
    input?: SortOrderInput | SortOrder
    output?: SortOrderInput | SortOrder
    error?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TaskStepCountOrderByAggregateInput
    _avg?: TaskStepAvgOrderByAggregateInput
    _max?: TaskStepMaxOrderByAggregateInput
    _min?: TaskStepMinOrderByAggregateInput
    _sum?: TaskStepSumOrderByAggregateInput
  }

  export type TaskStepScalarWhereWithAggregatesInput = {
    AND?: TaskStepScalarWhereWithAggregatesInput | TaskStepScalarWhereWithAggregatesInput[]
    OR?: TaskStepScalarWhereWithAggregatesInput[]
    NOT?: TaskStepScalarWhereWithAggregatesInput | TaskStepScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TaskStep"> | string
    taskId?: StringWithAggregatesFilter<"TaskStep"> | string
    idx?: IntWithAggregatesFilter<"TaskStep"> | number
    name?: StringWithAggregatesFilter<"TaskStep"> | string
    status?: StringWithAggregatesFilter<"TaskStep"> | string
    input?: StringNullableWithAggregatesFilter<"TaskStep"> | string | null
    output?: StringNullableWithAggregatesFilter<"TaskStep"> | string | null
    error?: StringNullableWithAggregatesFilter<"TaskStep"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"TaskStep"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"TaskStep"> | Date | string
  }

  export type TaskTraceWhereInput = {
    AND?: TaskTraceWhereInput | TaskTraceWhereInput[]
    OR?: TaskTraceWhereInput[]
    NOT?: TaskTraceWhereInput | TaskTraceWhereInput[]
    id?: StringFilter<"TaskTrace"> | string
    taskId?: StringFilter<"TaskTrace"> | string
    stepId?: StringNullableFilter<"TaskTrace"> | string | null
    role?: StringFilter<"TaskTrace"> | string
    content?: StringNullableFilter<"TaskTrace"> | string | null
    toolCalls?: StringNullableFilter<"TaskTrace"> | string | null
    createdAt?: DateTimeFilter<"TaskTrace"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }

  export type TaskTraceOrderByWithRelationInput = {
    id?: SortOrder
    taskId?: SortOrder
    stepId?: SortOrderInput | SortOrder
    role?: SortOrder
    content?: SortOrderInput | SortOrder
    toolCalls?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    task?: TaskOrderByWithRelationInput
  }

  export type TaskTraceWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TaskTraceWhereInput | TaskTraceWhereInput[]
    OR?: TaskTraceWhereInput[]
    NOT?: TaskTraceWhereInput | TaskTraceWhereInput[]
    taskId?: StringFilter<"TaskTrace"> | string
    stepId?: StringNullableFilter<"TaskTrace"> | string | null
    role?: StringFilter<"TaskTrace"> | string
    content?: StringNullableFilter<"TaskTrace"> | string | null
    toolCalls?: StringNullableFilter<"TaskTrace"> | string | null
    createdAt?: DateTimeFilter<"TaskTrace"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }, "id">

  export type TaskTraceOrderByWithAggregationInput = {
    id?: SortOrder
    taskId?: SortOrder
    stepId?: SortOrderInput | SortOrder
    role?: SortOrder
    content?: SortOrderInput | SortOrder
    toolCalls?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: TaskTraceCountOrderByAggregateInput
    _max?: TaskTraceMaxOrderByAggregateInput
    _min?: TaskTraceMinOrderByAggregateInput
  }

  export type TaskTraceScalarWhereWithAggregatesInput = {
    AND?: TaskTraceScalarWhereWithAggregatesInput | TaskTraceScalarWhereWithAggregatesInput[]
    OR?: TaskTraceScalarWhereWithAggregatesInput[]
    NOT?: TaskTraceScalarWhereWithAggregatesInput | TaskTraceScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TaskTrace"> | string
    taskId?: StringWithAggregatesFilter<"TaskTrace"> | string
    stepId?: StringNullableWithAggregatesFilter<"TaskTrace"> | string | null
    role?: StringWithAggregatesFilter<"TaskTrace"> | string
    content?: StringNullableWithAggregatesFilter<"TaskTrace"> | string | null
    toolCalls?: StringNullableWithAggregatesFilter<"TaskTrace"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"TaskTrace"> | Date | string
  }

  export type TaskDiffWhereInput = {
    AND?: TaskDiffWhereInput | TaskDiffWhereInput[]
    OR?: TaskDiffWhereInput[]
    NOT?: TaskDiffWhereInput | TaskDiffWhereInput[]
    id?: StringFilter<"TaskDiff"> | string
    taskId?: StringFilter<"TaskDiff"> | string
    branch?: StringFilter<"TaskDiff"> | string
    commitSha?: StringNullableFilter<"TaskDiff"> | string | null
    patch?: StringFilter<"TaskDiff"> | string
    createdAt?: DateTimeFilter<"TaskDiff"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }

  export type TaskDiffOrderByWithRelationInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    commitSha?: SortOrderInput | SortOrder
    patch?: SortOrder
    createdAt?: SortOrder
    task?: TaskOrderByWithRelationInput
  }

  export type TaskDiffWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TaskDiffWhereInput | TaskDiffWhereInput[]
    OR?: TaskDiffWhereInput[]
    NOT?: TaskDiffWhereInput | TaskDiffWhereInput[]
    taskId?: StringFilter<"TaskDiff"> | string
    branch?: StringFilter<"TaskDiff"> | string
    commitSha?: StringNullableFilter<"TaskDiff"> | string | null
    patch?: StringFilter<"TaskDiff"> | string
    createdAt?: DateTimeFilter<"TaskDiff"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }, "id">

  export type TaskDiffOrderByWithAggregationInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    commitSha?: SortOrderInput | SortOrder
    patch?: SortOrder
    createdAt?: SortOrder
    _count?: TaskDiffCountOrderByAggregateInput
    _max?: TaskDiffMaxOrderByAggregateInput
    _min?: TaskDiffMinOrderByAggregateInput
  }

  export type TaskDiffScalarWhereWithAggregatesInput = {
    AND?: TaskDiffScalarWhereWithAggregatesInput | TaskDiffScalarWhereWithAggregatesInput[]
    OR?: TaskDiffScalarWhereWithAggregatesInput[]
    NOT?: TaskDiffScalarWhereWithAggregatesInput | TaskDiffScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TaskDiff"> | string
    taskId?: StringWithAggregatesFilter<"TaskDiff"> | string
    branch?: StringWithAggregatesFilter<"TaskDiff"> | string
    commitSha?: StringNullableWithAggregatesFilter<"TaskDiff"> | string | null
    patch?: StringWithAggregatesFilter<"TaskDiff"> | string
    createdAt?: DateTimeWithAggregatesFilter<"TaskDiff"> | Date | string
  }

  export type AgentRunWhereInput = {
    AND?: AgentRunWhereInput | AgentRunWhereInput[]
    OR?: AgentRunWhereInput[]
    NOT?: AgentRunWhereInput | AgentRunWhereInput[]
    id?: StringFilter<"AgentRun"> | string
    taskId?: StringFilter<"AgentRun"> | string
    branch?: StringFilter<"AgentRun"> | string
    baseCommit?: StringFilter<"AgentRun"> | string
    resultStatus?: StringFilter<"AgentRun"> | string
    validationSummary?: StringNullableFilter<"AgentRun"> | string | null
    publishedVersion?: StringNullableFilter<"AgentRun"> | string | null
    promptTokens?: IntNullableFilter<"AgentRun"> | number | null
    completionTokens?: IntNullableFilter<"AgentRun"> | number | null
    totalTokens?: IntNullableFilter<"AgentRun"> | number | null
    createdAt?: DateTimeFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeFilter<"AgentRun"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }

  export type AgentRunOrderByWithRelationInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    baseCommit?: SortOrder
    resultStatus?: SortOrder
    validationSummary?: SortOrderInput | SortOrder
    publishedVersion?: SortOrderInput | SortOrder
    promptTokens?: SortOrderInput | SortOrder
    completionTokens?: SortOrderInput | SortOrder
    totalTokens?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    task?: TaskOrderByWithRelationInput
  }

  export type AgentRunWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: AgentRunWhereInput | AgentRunWhereInput[]
    OR?: AgentRunWhereInput[]
    NOT?: AgentRunWhereInput | AgentRunWhereInput[]
    taskId?: StringFilter<"AgentRun"> | string
    branch?: StringFilter<"AgentRun"> | string
    baseCommit?: StringFilter<"AgentRun"> | string
    resultStatus?: StringFilter<"AgentRun"> | string
    validationSummary?: StringNullableFilter<"AgentRun"> | string | null
    publishedVersion?: StringNullableFilter<"AgentRun"> | string | null
    promptTokens?: IntNullableFilter<"AgentRun"> | number | null
    completionTokens?: IntNullableFilter<"AgentRun"> | number | null
    totalTokens?: IntNullableFilter<"AgentRun"> | number | null
    createdAt?: DateTimeFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeFilter<"AgentRun"> | Date | string
    task?: XOR<TaskRelationFilter, TaskWhereInput>
  }, "id">

  export type AgentRunOrderByWithAggregationInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    baseCommit?: SortOrder
    resultStatus?: SortOrder
    validationSummary?: SortOrderInput | SortOrder
    publishedVersion?: SortOrderInput | SortOrder
    promptTokens?: SortOrderInput | SortOrder
    completionTokens?: SortOrderInput | SortOrder
    totalTokens?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: AgentRunCountOrderByAggregateInput
    _avg?: AgentRunAvgOrderByAggregateInput
    _max?: AgentRunMaxOrderByAggregateInput
    _min?: AgentRunMinOrderByAggregateInput
    _sum?: AgentRunSumOrderByAggregateInput
  }

  export type AgentRunScalarWhereWithAggregatesInput = {
    AND?: AgentRunScalarWhereWithAggregatesInput | AgentRunScalarWhereWithAggregatesInput[]
    OR?: AgentRunScalarWhereWithAggregatesInput[]
    NOT?: AgentRunScalarWhereWithAggregatesInput | AgentRunScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AgentRun"> | string
    taskId?: StringWithAggregatesFilter<"AgentRun"> | string
    branch?: StringWithAggregatesFilter<"AgentRun"> | string
    baseCommit?: StringWithAggregatesFilter<"AgentRun"> | string
    resultStatus?: StringWithAggregatesFilter<"AgentRun"> | string
    validationSummary?: StringNullableWithAggregatesFilter<"AgentRun"> | string | null
    publishedVersion?: StringNullableWithAggregatesFilter<"AgentRun"> | string | null
    promptTokens?: IntNullableWithAggregatesFilter<"AgentRun"> | number | null
    completionTokens?: IntNullableWithAggregatesFilter<"AgentRun"> | number | null
    totalTokens?: IntNullableWithAggregatesFilter<"AgentRun"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"AgentRun"> | Date | string
  }

  export type TraceSpanWhereInput = {
    AND?: TraceSpanWhereInput | TraceSpanWhereInput[]
    OR?: TraceSpanWhereInput[]
    NOT?: TraceSpanWhereInput | TraceSpanWhereInput[]
    id?: StringFilter<"TraceSpan"> | string
    traceId?: StringFilter<"TraceSpan"> | string
    spanId?: StringFilter<"TraceSpan"> | string
    parentId?: StringNullableFilter<"TraceSpan"> | string | null
    taskId?: StringNullableFilter<"TraceSpan"> | string | null
    name?: StringFilter<"TraceSpan"> | string
    startTime?: DateTimeFilter<"TraceSpan"> | Date | string
    endTime?: DateTimeNullableFilter<"TraceSpan"> | Date | string | null
    status?: StringFilter<"TraceSpan"> | string
    attributes?: StringNullableFilter<"TraceSpan"> | string | null
    events?: StringNullableFilter<"TraceSpan"> | string | null
    task?: XOR<TaskNullableRelationFilter, TaskWhereInput> | null
  }

  export type TraceSpanOrderByWithRelationInput = {
    id?: SortOrder
    traceId?: SortOrder
    spanId?: SortOrder
    parentId?: SortOrderInput | SortOrder
    taskId?: SortOrderInput | SortOrder
    name?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrderInput | SortOrder
    status?: SortOrder
    attributes?: SortOrderInput | SortOrder
    events?: SortOrderInput | SortOrder
    task?: TaskOrderByWithRelationInput
  }

  export type TraceSpanWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TraceSpanWhereInput | TraceSpanWhereInput[]
    OR?: TraceSpanWhereInput[]
    NOT?: TraceSpanWhereInput | TraceSpanWhereInput[]
    traceId?: StringFilter<"TraceSpan"> | string
    spanId?: StringFilter<"TraceSpan"> | string
    parentId?: StringNullableFilter<"TraceSpan"> | string | null
    taskId?: StringNullableFilter<"TraceSpan"> | string | null
    name?: StringFilter<"TraceSpan"> | string
    startTime?: DateTimeFilter<"TraceSpan"> | Date | string
    endTime?: DateTimeNullableFilter<"TraceSpan"> | Date | string | null
    status?: StringFilter<"TraceSpan"> | string
    attributes?: StringNullableFilter<"TraceSpan"> | string | null
    events?: StringNullableFilter<"TraceSpan"> | string | null
    task?: XOR<TaskNullableRelationFilter, TaskWhereInput> | null
  }, "id">

  export type TraceSpanOrderByWithAggregationInput = {
    id?: SortOrder
    traceId?: SortOrder
    spanId?: SortOrder
    parentId?: SortOrderInput | SortOrder
    taskId?: SortOrderInput | SortOrder
    name?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrderInput | SortOrder
    status?: SortOrder
    attributes?: SortOrderInput | SortOrder
    events?: SortOrderInput | SortOrder
    _count?: TraceSpanCountOrderByAggregateInput
    _max?: TraceSpanMaxOrderByAggregateInput
    _min?: TraceSpanMinOrderByAggregateInput
  }

  export type TraceSpanScalarWhereWithAggregatesInput = {
    AND?: TraceSpanScalarWhereWithAggregatesInput | TraceSpanScalarWhereWithAggregatesInput[]
    OR?: TraceSpanScalarWhereWithAggregatesInput[]
    NOT?: TraceSpanScalarWhereWithAggregatesInput | TraceSpanScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TraceSpan"> | string
    traceId?: StringWithAggregatesFilter<"TraceSpan"> | string
    spanId?: StringWithAggregatesFilter<"TraceSpan"> | string
    parentId?: StringNullableWithAggregatesFilter<"TraceSpan"> | string | null
    taskId?: StringNullableWithAggregatesFilter<"TraceSpan"> | string | null
    name?: StringWithAggregatesFilter<"TraceSpan"> | string
    startTime?: DateTimeWithAggregatesFilter<"TraceSpan"> | Date | string
    endTime?: DateTimeNullableWithAggregatesFilter<"TraceSpan"> | Date | string | null
    status?: StringWithAggregatesFilter<"TraceSpan"> | string
    attributes?: StringNullableWithAggregatesFilter<"TraceSpan"> | string | null
    events?: StringNullableWithAggregatesFilter<"TraceSpan"> | string | null
  }

  export type ProviderConfigWhereInput = {
    AND?: ProviderConfigWhereInput | ProviderConfigWhereInput[]
    OR?: ProviderConfigWhereInput[]
    NOT?: ProviderConfigWhereInput | ProviderConfigWhereInput[]
    id?: StringFilter<"ProviderConfig"> | string
    name?: StringFilter<"ProviderConfig"> | string
    kind?: StringFilter<"ProviderConfig"> | string
    baseUrl?: StringNullableFilter<"ProviderConfig"> | string | null
    apiKey?: StringNullableFilter<"ProviderConfig"> | string | null
    defaultModel?: StringFilter<"ProviderConfig"> | string
    capabilities?: StringFilter<"ProviderConfig"> | string
    enabled?: BoolFilter<"ProviderConfig"> | boolean
    createdAt?: DateTimeFilter<"ProviderConfig"> | Date | string
  }

  export type ProviderConfigOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    kind?: SortOrder
    baseUrl?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    defaultModel?: SortOrder
    capabilities?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
  }

  export type ProviderConfigWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    name?: string
    AND?: ProviderConfigWhereInput | ProviderConfigWhereInput[]
    OR?: ProviderConfigWhereInput[]
    NOT?: ProviderConfigWhereInput | ProviderConfigWhereInput[]
    kind?: StringFilter<"ProviderConfig"> | string
    baseUrl?: StringNullableFilter<"ProviderConfig"> | string | null
    apiKey?: StringNullableFilter<"ProviderConfig"> | string | null
    defaultModel?: StringFilter<"ProviderConfig"> | string
    capabilities?: StringFilter<"ProviderConfig"> | string
    enabled?: BoolFilter<"ProviderConfig"> | boolean
    createdAt?: DateTimeFilter<"ProviderConfig"> | Date | string
  }, "id" | "name">

  export type ProviderConfigOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    kind?: SortOrder
    baseUrl?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    defaultModel?: SortOrder
    capabilities?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    _count?: ProviderConfigCountOrderByAggregateInput
    _max?: ProviderConfigMaxOrderByAggregateInput
    _min?: ProviderConfigMinOrderByAggregateInput
  }

  export type ProviderConfigScalarWhereWithAggregatesInput = {
    AND?: ProviderConfigScalarWhereWithAggregatesInput | ProviderConfigScalarWhereWithAggregatesInput[]
    OR?: ProviderConfigScalarWhereWithAggregatesInput[]
    NOT?: ProviderConfigScalarWhereWithAggregatesInput | ProviderConfigScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"ProviderConfig"> | string
    name?: StringWithAggregatesFilter<"ProviderConfig"> | string
    kind?: StringWithAggregatesFilter<"ProviderConfig"> | string
    baseUrl?: StringNullableWithAggregatesFilter<"ProviderConfig"> | string | null
    apiKey?: StringNullableWithAggregatesFilter<"ProviderConfig"> | string | null
    defaultModel?: StringWithAggregatesFilter<"ProviderConfig"> | string
    capabilities?: StringWithAggregatesFilter<"ProviderConfig"> | string
    enabled?: BoolWithAggregatesFilter<"ProviderConfig"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"ProviderConfig"> | Date | string
  }

  export type SkillArtifactWhereInput = {
    AND?: SkillArtifactWhereInput | SkillArtifactWhereInput[]
    OR?: SkillArtifactWhereInput[]
    NOT?: SkillArtifactWhereInput | SkillArtifactWhereInput[]
    id?: StringFilter<"SkillArtifact"> | string
    name?: StringFilter<"SkillArtifact"> | string
    sourcePath?: StringFilter<"SkillArtifact"> | string
    generatedPath?: StringFilter<"SkillArtifact"> | string
    manifest?: StringFilter<"SkillArtifact"> | string
    registeredAt?: DateTimeFilter<"SkillArtifact"> | Date | string
  }

  export type SkillArtifactOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    generatedPath?: SortOrder
    manifest?: SortOrder
    registeredAt?: SortOrder
  }

  export type SkillArtifactWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    name?: string
    AND?: SkillArtifactWhereInput | SkillArtifactWhereInput[]
    OR?: SkillArtifactWhereInput[]
    NOT?: SkillArtifactWhereInput | SkillArtifactWhereInput[]
    sourcePath?: StringFilter<"SkillArtifact"> | string
    generatedPath?: StringFilter<"SkillArtifact"> | string
    manifest?: StringFilter<"SkillArtifact"> | string
    registeredAt?: DateTimeFilter<"SkillArtifact"> | Date | string
  }, "id" | "name">

  export type SkillArtifactOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    generatedPath?: SortOrder
    manifest?: SortOrder
    registeredAt?: SortOrder
    _count?: SkillArtifactCountOrderByAggregateInput
    _max?: SkillArtifactMaxOrderByAggregateInput
    _min?: SkillArtifactMinOrderByAggregateInput
  }

  export type SkillArtifactScalarWhereWithAggregatesInput = {
    AND?: SkillArtifactScalarWhereWithAggregatesInput | SkillArtifactScalarWhereWithAggregatesInput[]
    OR?: SkillArtifactScalarWhereWithAggregatesInput[]
    NOT?: SkillArtifactScalarWhereWithAggregatesInput | SkillArtifactScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"SkillArtifact"> | string
    name?: StringWithAggregatesFilter<"SkillArtifact"> | string
    sourcePath?: StringWithAggregatesFilter<"SkillArtifact"> | string
    generatedPath?: StringWithAggregatesFilter<"SkillArtifact"> | string
    manifest?: StringWithAggregatesFilter<"SkillArtifact"> | string
    registeredAt?: DateTimeWithAggregatesFilter<"SkillArtifact"> | Date | string
  }

  export type PromptVersionWhereInput = {
    AND?: PromptVersionWhereInput | PromptVersionWhereInput[]
    OR?: PromptVersionWhereInput[]
    NOT?: PromptVersionWhereInput | PromptVersionWhereInput[]
    id?: StringFilter<"PromptVersion"> | string
    name?: StringFilter<"PromptVersion"> | string
    sourcePath?: StringFilter<"PromptVersion"> | string
    systemPrompt?: StringFilter<"PromptVersion"> | string
    textToolsPrompt?: StringFilter<"PromptVersion"> | string
    hash?: StringFilter<"PromptVersion"> | string
    metadata?: StringNullableFilter<"PromptVersion"> | string | null
    createdAt?: DateTimeFilter<"PromptVersion"> | Date | string
  }

  export type PromptVersionOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    systemPrompt?: SortOrder
    textToolsPrompt?: SortOrder
    hash?: SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
  }

  export type PromptVersionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    name?: string
    AND?: PromptVersionWhereInput | PromptVersionWhereInput[]
    OR?: PromptVersionWhereInput[]
    NOT?: PromptVersionWhereInput | PromptVersionWhereInput[]
    sourcePath?: StringFilter<"PromptVersion"> | string
    systemPrompt?: StringFilter<"PromptVersion"> | string
    textToolsPrompt?: StringFilter<"PromptVersion"> | string
    hash?: StringFilter<"PromptVersion"> | string
    metadata?: StringNullableFilter<"PromptVersion"> | string | null
    createdAt?: DateTimeFilter<"PromptVersion"> | Date | string
  }, "id" | "name">

  export type PromptVersionOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    systemPrompt?: SortOrder
    textToolsPrompt?: SortOrder
    hash?: SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PromptVersionCountOrderByAggregateInput
    _max?: PromptVersionMaxOrderByAggregateInput
    _min?: PromptVersionMinOrderByAggregateInput
  }

  export type PromptVersionScalarWhereWithAggregatesInput = {
    AND?: PromptVersionScalarWhereWithAggregatesInput | PromptVersionScalarWhereWithAggregatesInput[]
    OR?: PromptVersionScalarWhereWithAggregatesInput[]
    NOT?: PromptVersionScalarWhereWithAggregatesInput | PromptVersionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PromptVersion"> | string
    name?: StringWithAggregatesFilter<"PromptVersion"> | string
    sourcePath?: StringWithAggregatesFilter<"PromptVersion"> | string
    systemPrompt?: StringWithAggregatesFilter<"PromptVersion"> | string
    textToolsPrompt?: StringWithAggregatesFilter<"PromptVersion"> | string
    hash?: StringWithAggregatesFilter<"PromptVersion"> | string
    metadata?: StringNullableWithAggregatesFilter<"PromptVersion"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PromptVersion"> | Date | string
  }

  export type ProjectCreateInput = {
    id?: string
    name: string
    path: string
    repoUrl?: string | null
    description?: string | null
    env?: string | null
    createdAt?: Date | string
    tasks?: TaskCreateNestedManyWithoutProjectInput
  }

  export type ProjectUncheckedCreateInput = {
    id?: string
    name: string
    path: string
    repoUrl?: string | null
    description?: string | null
    env?: string | null
    createdAt?: Date | string
    tasks?: TaskUncheckedCreateNestedManyWithoutProjectInput
  }

  export type ProjectUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    repoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    env?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tasks?: TaskUpdateManyWithoutProjectNestedInput
  }

  export type ProjectUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    repoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    env?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tasks?: TaskUncheckedUpdateManyWithoutProjectNestedInput
  }

  export type ProjectCreateManyInput = {
    id?: string
    name: string
    path: string
    repoUrl?: string | null
    description?: string | null
    env?: string | null
    createdAt?: Date | string
  }

  export type ProjectUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    repoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    env?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    repoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    env?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskCreateInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutTasksInput
    steps?: TaskStepCreateNestedManyWithoutTaskInput
    traces?: TaskTraceCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepUncheckedCreateNestedManyWithoutTaskInput
    traces?: TaskTraceUncheckedCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffUncheckedCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutTasksNestedInput
    steps?: TaskStepUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUncheckedUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUncheckedUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUncheckedUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskCreateManyInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepCreateInput = {
    id?: string
    idx: number
    name: string
    status?: string
    input?: string | null
    output?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    task: TaskCreateNestedOneWithoutStepsInput
  }

  export type TaskStepUncheckedCreateInput = {
    id?: string
    taskId: string
    idx: number
    name: string
    status?: string
    input?: string | null
    output?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskStepUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    task?: TaskUpdateOneRequiredWithoutStepsNestedInput
  }

  export type TaskStepUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepCreateManyInput = {
    id?: string
    taskId: string
    idx: number
    name: string
    status?: string
    input?: string | null
    output?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskStepUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskTraceCreateInput = {
    id?: string
    stepId?: string | null
    role: string
    content?: string | null
    toolCalls?: string | null
    createdAt?: Date | string
    task: TaskCreateNestedOneWithoutTracesInput
  }

  export type TaskTraceUncheckedCreateInput = {
    id?: string
    taskId: string
    stepId?: string | null
    role: string
    content?: string | null
    toolCalls?: string | null
    createdAt?: Date | string
  }

  export type TaskTraceUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    task?: TaskUpdateOneRequiredWithoutTracesNestedInput
  }

  export type TaskTraceUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskTraceCreateManyInput = {
    id?: string
    taskId: string
    stepId?: string | null
    role: string
    content?: string | null
    toolCalls?: string | null
    createdAt?: Date | string
  }

  export type TaskTraceUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskTraceUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskDiffCreateInput = {
    id?: string
    branch: string
    commitSha?: string | null
    patch: string
    createdAt?: Date | string
    task: TaskCreateNestedOneWithoutDiffsInput
  }

  export type TaskDiffUncheckedCreateInput = {
    id?: string
    taskId: string
    branch: string
    commitSha?: string | null
    patch: string
    createdAt?: Date | string
  }

  export type TaskDiffUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    task?: TaskUpdateOneRequiredWithoutDiffsNestedInput
  }

  export type TaskDiffUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskDiffCreateManyInput = {
    id?: string
    taskId: string
    branch: string
    commitSha?: string | null
    patch: string
    createdAt?: Date | string
  }

  export type TaskDiffUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskDiffUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunCreateInput = {
    id?: string
    branch: string
    baseCommit: string
    resultStatus?: string
    validationSummary?: string | null
    publishedVersion?: string | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    task: TaskCreateNestedOneWithoutAgentRunsInput
  }

  export type AgentRunUncheckedCreateInput = {
    id?: string
    taskId: string
    branch: string
    baseCommit: string
    resultStatus?: string
    validationSummary?: string | null
    publishedVersion?: string | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    task?: TaskUpdateOneRequiredWithoutAgentRunsNestedInput
  }

  export type AgentRunUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunCreateManyInput = {
    id?: string
    taskId: string
    branch: string
    baseCommit: string
    resultStatus?: string
    validationSummary?: string | null
    publishedVersion?: string | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    taskId?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TraceSpanCreateInput = {
    id?: string
    traceId: string
    spanId: string
    parentId?: string | null
    name: string
    startTime?: Date | string
    endTime?: Date | string | null
    status?: string
    attributes?: string | null
    events?: string | null
    task?: TaskCreateNestedOneWithoutTraceSpansInput
  }

  export type TraceSpanUncheckedCreateInput = {
    id?: string
    traceId: string
    spanId: string
    parentId?: string | null
    taskId?: string | null
    name: string
    startTime?: Date | string
    endTime?: Date | string | null
    status?: string
    attributes?: string | null
    events?: string | null
  }

  export type TraceSpanUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
    task?: TaskUpdateOneWithoutTraceSpansNestedInput
  }

  export type TraceSpanUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    taskId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type TraceSpanCreateManyInput = {
    id?: string
    traceId: string
    spanId: string
    parentId?: string | null
    taskId?: string | null
    name: string
    startTime?: Date | string
    endTime?: Date | string | null
    status?: string
    attributes?: string | null
    events?: string | null
  }

  export type TraceSpanUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type TraceSpanUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    taskId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type ProviderConfigCreateInput = {
    id?: string
    name: string
    kind: string
    baseUrl?: string | null
    apiKey?: string | null
    defaultModel: string
    capabilities: string
    enabled?: boolean
    createdAt?: Date | string
  }

  export type ProviderConfigUncheckedCreateInput = {
    id?: string
    name: string
    kind: string
    baseUrl?: string | null
    apiKey?: string | null
    defaultModel: string
    capabilities: string
    enabled?: boolean
    createdAt?: Date | string
  }

  export type ProviderConfigUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    kind?: StringFieldUpdateOperationsInput | string
    baseUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: StringFieldUpdateOperationsInput | string
    capabilities?: StringFieldUpdateOperationsInput | string
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProviderConfigUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    kind?: StringFieldUpdateOperationsInput | string
    baseUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: StringFieldUpdateOperationsInput | string
    capabilities?: StringFieldUpdateOperationsInput | string
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProviderConfigCreateManyInput = {
    id?: string
    name: string
    kind: string
    baseUrl?: string | null
    apiKey?: string | null
    defaultModel: string
    capabilities: string
    enabled?: boolean
    createdAt?: Date | string
  }

  export type ProviderConfigUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    kind?: StringFieldUpdateOperationsInput | string
    baseUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: StringFieldUpdateOperationsInput | string
    capabilities?: StringFieldUpdateOperationsInput | string
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProviderConfigUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    kind?: StringFieldUpdateOperationsInput | string
    baseUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: StringFieldUpdateOperationsInput | string
    capabilities?: StringFieldUpdateOperationsInput | string
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SkillArtifactCreateInput = {
    id?: string
    name: string
    sourcePath: string
    generatedPath: string
    manifest: string
    registeredAt?: Date | string
  }

  export type SkillArtifactUncheckedCreateInput = {
    id?: string
    name: string
    sourcePath: string
    generatedPath: string
    manifest: string
    registeredAt?: Date | string
  }

  export type SkillArtifactUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    generatedPath?: StringFieldUpdateOperationsInput | string
    manifest?: StringFieldUpdateOperationsInput | string
    registeredAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SkillArtifactUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    generatedPath?: StringFieldUpdateOperationsInput | string
    manifest?: StringFieldUpdateOperationsInput | string
    registeredAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SkillArtifactCreateManyInput = {
    id?: string
    name: string
    sourcePath: string
    generatedPath: string
    manifest: string
    registeredAt?: Date | string
  }

  export type SkillArtifactUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    generatedPath?: StringFieldUpdateOperationsInput | string
    manifest?: StringFieldUpdateOperationsInput | string
    registeredAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SkillArtifactUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    generatedPath?: StringFieldUpdateOperationsInput | string
    manifest?: StringFieldUpdateOperationsInput | string
    registeredAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PromptVersionCreateInput = {
    id?: string
    name: string
    sourcePath: string
    systemPrompt: string
    textToolsPrompt: string
    hash: string
    metadata?: string | null
    createdAt?: Date | string
  }

  export type PromptVersionUncheckedCreateInput = {
    id?: string
    name: string
    sourcePath: string
    systemPrompt: string
    textToolsPrompt: string
    hash: string
    metadata?: string | null
    createdAt?: Date | string
  }

  export type PromptVersionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    systemPrompt?: StringFieldUpdateOperationsInput | string
    textToolsPrompt?: StringFieldUpdateOperationsInput | string
    hash?: StringFieldUpdateOperationsInput | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PromptVersionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    systemPrompt?: StringFieldUpdateOperationsInput | string
    textToolsPrompt?: StringFieldUpdateOperationsInput | string
    hash?: StringFieldUpdateOperationsInput | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PromptVersionCreateManyInput = {
    id?: string
    name: string
    sourcePath: string
    systemPrompt: string
    textToolsPrompt: string
    hash: string
    metadata?: string | null
    createdAt?: Date | string
  }

  export type PromptVersionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    systemPrompt?: StringFieldUpdateOperationsInput | string
    textToolsPrompt?: StringFieldUpdateOperationsInput | string
    hash?: StringFieldUpdateOperationsInput | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PromptVersionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    sourcePath?: StringFieldUpdateOperationsInput | string
    systemPrompt?: StringFieldUpdateOperationsInput | string
    textToolsPrompt?: StringFieldUpdateOperationsInput | string
    hash?: StringFieldUpdateOperationsInput | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type TaskListRelationFilter = {
    every?: TaskWhereInput
    some?: TaskWhereInput
    none?: TaskWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type TaskOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ProjectCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    path?: SortOrder
    repoUrl?: SortOrder
    description?: SortOrder
    env?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    path?: SortOrder
    repoUrl?: SortOrder
    description?: SortOrder
    env?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    path?: SortOrder
    repoUrl?: SortOrder
    description?: SortOrder
    env?: SortOrder
    createdAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type ProjectRelationFilter = {
    is?: ProjectWhereInput
    isNot?: ProjectWhereInput
  }

  export type TaskStepListRelationFilter = {
    every?: TaskStepWhereInput
    some?: TaskStepWhereInput
    none?: TaskStepWhereInput
  }

  export type TaskTraceListRelationFilter = {
    every?: TaskTraceWhereInput
    some?: TaskTraceWhereInput
    none?: TaskTraceWhereInput
  }

  export type TaskDiffListRelationFilter = {
    every?: TaskDiffWhereInput
    some?: TaskDiffWhereInput
    none?: TaskDiffWhereInput
  }

  export type AgentRunListRelationFilter = {
    every?: AgentRunWhereInput
    some?: AgentRunWhereInput
    none?: AgentRunWhereInput
  }

  export type TraceSpanListRelationFilter = {
    every?: TraceSpanWhereInput
    some?: TraceSpanWhereInput
    none?: TraceSpanWhereInput
  }

  export type TaskStepOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TaskTraceOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TaskDiffOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AgentRunOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TraceSpanOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TaskCountOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    status?: SortOrder
    complexity?: SortOrder
    tags?: SortOrder
    provider?: SortOrder
    model?: SortOrder
    result?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TaskMaxOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    status?: SortOrder
    complexity?: SortOrder
    tags?: SortOrder
    provider?: SortOrder
    model?: SortOrder
    result?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TaskMinOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    status?: SortOrder
    complexity?: SortOrder
    tags?: SortOrder
    provider?: SortOrder
    model?: SortOrder
    result?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type TaskRelationFilter = {
    is?: TaskWhereInput
    isNot?: TaskWhereInput
  }

  export type TaskStepCountOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    idx?: SortOrder
    name?: SortOrder
    status?: SortOrder
    input?: SortOrder
    output?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TaskStepAvgOrderByAggregateInput = {
    idx?: SortOrder
  }

  export type TaskStepMaxOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    idx?: SortOrder
    name?: SortOrder
    status?: SortOrder
    input?: SortOrder
    output?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TaskStepMinOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    idx?: SortOrder
    name?: SortOrder
    status?: SortOrder
    input?: SortOrder
    output?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TaskStepSumOrderByAggregateInput = {
    idx?: SortOrder
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type TaskTraceCountOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    stepId?: SortOrder
    role?: SortOrder
    content?: SortOrder
    toolCalls?: SortOrder
    createdAt?: SortOrder
  }

  export type TaskTraceMaxOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    stepId?: SortOrder
    role?: SortOrder
    content?: SortOrder
    toolCalls?: SortOrder
    createdAt?: SortOrder
  }

  export type TaskTraceMinOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    stepId?: SortOrder
    role?: SortOrder
    content?: SortOrder
    toolCalls?: SortOrder
    createdAt?: SortOrder
  }

  export type TaskDiffCountOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    commitSha?: SortOrder
    patch?: SortOrder
    createdAt?: SortOrder
  }

  export type TaskDiffMaxOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    commitSha?: SortOrder
    patch?: SortOrder
    createdAt?: SortOrder
  }

  export type TaskDiffMinOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    commitSha?: SortOrder
    patch?: SortOrder
    createdAt?: SortOrder
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type AgentRunCountOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    baseCommit?: SortOrder
    resultStatus?: SortOrder
    validationSummary?: SortOrder
    publishedVersion?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentRunAvgOrderByAggregateInput = {
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
  }

  export type AgentRunMaxOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    baseCommit?: SortOrder
    resultStatus?: SortOrder
    validationSummary?: SortOrder
    publishedVersion?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentRunMinOrderByAggregateInput = {
    id?: SortOrder
    taskId?: SortOrder
    branch?: SortOrder
    baseCommit?: SortOrder
    resultStatus?: SortOrder
    validationSummary?: SortOrder
    publishedVersion?: SortOrder
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type AgentRunSumOrderByAggregateInput = {
    promptTokens?: SortOrder
    completionTokens?: SortOrder
    totalTokens?: SortOrder
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type TaskNullableRelationFilter = {
    is?: TaskWhereInput | null
    isNot?: TaskWhereInput | null
  }

  export type TraceSpanCountOrderByAggregateInput = {
    id?: SortOrder
    traceId?: SortOrder
    spanId?: SortOrder
    parentId?: SortOrder
    taskId?: SortOrder
    name?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
    status?: SortOrder
    attributes?: SortOrder
    events?: SortOrder
  }

  export type TraceSpanMaxOrderByAggregateInput = {
    id?: SortOrder
    traceId?: SortOrder
    spanId?: SortOrder
    parentId?: SortOrder
    taskId?: SortOrder
    name?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
    status?: SortOrder
    attributes?: SortOrder
    events?: SortOrder
  }

  export type TraceSpanMinOrderByAggregateInput = {
    id?: SortOrder
    traceId?: SortOrder
    spanId?: SortOrder
    parentId?: SortOrder
    taskId?: SortOrder
    name?: SortOrder
    startTime?: SortOrder
    endTime?: SortOrder
    status?: SortOrder
    attributes?: SortOrder
    events?: SortOrder
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type ProviderConfigCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    kind?: SortOrder
    baseUrl?: SortOrder
    apiKey?: SortOrder
    defaultModel?: SortOrder
    capabilities?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
  }

  export type ProviderConfigMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    kind?: SortOrder
    baseUrl?: SortOrder
    apiKey?: SortOrder
    defaultModel?: SortOrder
    capabilities?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
  }

  export type ProviderConfigMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    kind?: SortOrder
    baseUrl?: SortOrder
    apiKey?: SortOrder
    defaultModel?: SortOrder
    capabilities?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type SkillArtifactCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    generatedPath?: SortOrder
    manifest?: SortOrder
    registeredAt?: SortOrder
  }

  export type SkillArtifactMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    generatedPath?: SortOrder
    manifest?: SortOrder
    registeredAt?: SortOrder
  }

  export type SkillArtifactMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    generatedPath?: SortOrder
    manifest?: SortOrder
    registeredAt?: SortOrder
  }

  export type PromptVersionCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    systemPrompt?: SortOrder
    textToolsPrompt?: SortOrder
    hash?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
  }

  export type PromptVersionMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    systemPrompt?: SortOrder
    textToolsPrompt?: SortOrder
    hash?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
  }

  export type PromptVersionMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    sourcePath?: SortOrder
    systemPrompt?: SortOrder
    textToolsPrompt?: SortOrder
    hash?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
  }

  export type TaskCreateNestedManyWithoutProjectInput = {
    create?: XOR<TaskCreateWithoutProjectInput, TaskUncheckedCreateWithoutProjectInput> | TaskCreateWithoutProjectInput[] | TaskUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: TaskCreateOrConnectWithoutProjectInput | TaskCreateOrConnectWithoutProjectInput[]
    createMany?: TaskCreateManyProjectInputEnvelope
    connect?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
  }

  export type TaskUncheckedCreateNestedManyWithoutProjectInput = {
    create?: XOR<TaskCreateWithoutProjectInput, TaskUncheckedCreateWithoutProjectInput> | TaskCreateWithoutProjectInput[] | TaskUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: TaskCreateOrConnectWithoutProjectInput | TaskCreateOrConnectWithoutProjectInput[]
    createMany?: TaskCreateManyProjectInputEnvelope
    connect?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type TaskUpdateManyWithoutProjectNestedInput = {
    create?: XOR<TaskCreateWithoutProjectInput, TaskUncheckedCreateWithoutProjectInput> | TaskCreateWithoutProjectInput[] | TaskUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: TaskCreateOrConnectWithoutProjectInput | TaskCreateOrConnectWithoutProjectInput[]
    upsert?: TaskUpsertWithWhereUniqueWithoutProjectInput | TaskUpsertWithWhereUniqueWithoutProjectInput[]
    createMany?: TaskCreateManyProjectInputEnvelope
    set?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    disconnect?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    delete?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    connect?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    update?: TaskUpdateWithWhereUniqueWithoutProjectInput | TaskUpdateWithWhereUniqueWithoutProjectInput[]
    updateMany?: TaskUpdateManyWithWhereWithoutProjectInput | TaskUpdateManyWithWhereWithoutProjectInput[]
    deleteMany?: TaskScalarWhereInput | TaskScalarWhereInput[]
  }

  export type TaskUncheckedUpdateManyWithoutProjectNestedInput = {
    create?: XOR<TaskCreateWithoutProjectInput, TaskUncheckedCreateWithoutProjectInput> | TaskCreateWithoutProjectInput[] | TaskUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: TaskCreateOrConnectWithoutProjectInput | TaskCreateOrConnectWithoutProjectInput[]
    upsert?: TaskUpsertWithWhereUniqueWithoutProjectInput | TaskUpsertWithWhereUniqueWithoutProjectInput[]
    createMany?: TaskCreateManyProjectInputEnvelope
    set?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    disconnect?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    delete?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    connect?: TaskWhereUniqueInput | TaskWhereUniqueInput[]
    update?: TaskUpdateWithWhereUniqueWithoutProjectInput | TaskUpdateWithWhereUniqueWithoutProjectInput[]
    updateMany?: TaskUpdateManyWithWhereWithoutProjectInput | TaskUpdateManyWithWhereWithoutProjectInput[]
    deleteMany?: TaskScalarWhereInput | TaskScalarWhereInput[]
  }

  export type ProjectCreateNestedOneWithoutTasksInput = {
    create?: XOR<ProjectCreateWithoutTasksInput, ProjectUncheckedCreateWithoutTasksInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutTasksInput
    connect?: ProjectWhereUniqueInput
  }

  export type TaskStepCreateNestedManyWithoutTaskInput = {
    create?: XOR<TaskStepCreateWithoutTaskInput, TaskStepUncheckedCreateWithoutTaskInput> | TaskStepCreateWithoutTaskInput[] | TaskStepUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskStepCreateOrConnectWithoutTaskInput | TaskStepCreateOrConnectWithoutTaskInput[]
    createMany?: TaskStepCreateManyTaskInputEnvelope
    connect?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
  }

  export type TaskTraceCreateNestedManyWithoutTaskInput = {
    create?: XOR<TaskTraceCreateWithoutTaskInput, TaskTraceUncheckedCreateWithoutTaskInput> | TaskTraceCreateWithoutTaskInput[] | TaskTraceUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskTraceCreateOrConnectWithoutTaskInput | TaskTraceCreateOrConnectWithoutTaskInput[]
    createMany?: TaskTraceCreateManyTaskInputEnvelope
    connect?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
  }

  export type TaskDiffCreateNestedManyWithoutTaskInput = {
    create?: XOR<TaskDiffCreateWithoutTaskInput, TaskDiffUncheckedCreateWithoutTaskInput> | TaskDiffCreateWithoutTaskInput[] | TaskDiffUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskDiffCreateOrConnectWithoutTaskInput | TaskDiffCreateOrConnectWithoutTaskInput[]
    createMany?: TaskDiffCreateManyTaskInputEnvelope
    connect?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
  }

  export type AgentRunCreateNestedManyWithoutTaskInput = {
    create?: XOR<AgentRunCreateWithoutTaskInput, AgentRunUncheckedCreateWithoutTaskInput> | AgentRunCreateWithoutTaskInput[] | AgentRunUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutTaskInput | AgentRunCreateOrConnectWithoutTaskInput[]
    createMany?: AgentRunCreateManyTaskInputEnvelope
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
  }

  export type TraceSpanCreateNestedManyWithoutTaskInput = {
    create?: XOR<TraceSpanCreateWithoutTaskInput, TraceSpanUncheckedCreateWithoutTaskInput> | TraceSpanCreateWithoutTaskInput[] | TraceSpanUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TraceSpanCreateOrConnectWithoutTaskInput | TraceSpanCreateOrConnectWithoutTaskInput[]
    createMany?: TraceSpanCreateManyTaskInputEnvelope
    connect?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
  }

  export type TaskStepUncheckedCreateNestedManyWithoutTaskInput = {
    create?: XOR<TaskStepCreateWithoutTaskInput, TaskStepUncheckedCreateWithoutTaskInput> | TaskStepCreateWithoutTaskInput[] | TaskStepUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskStepCreateOrConnectWithoutTaskInput | TaskStepCreateOrConnectWithoutTaskInput[]
    createMany?: TaskStepCreateManyTaskInputEnvelope
    connect?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
  }

  export type TaskTraceUncheckedCreateNestedManyWithoutTaskInput = {
    create?: XOR<TaskTraceCreateWithoutTaskInput, TaskTraceUncheckedCreateWithoutTaskInput> | TaskTraceCreateWithoutTaskInput[] | TaskTraceUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskTraceCreateOrConnectWithoutTaskInput | TaskTraceCreateOrConnectWithoutTaskInput[]
    createMany?: TaskTraceCreateManyTaskInputEnvelope
    connect?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
  }

  export type TaskDiffUncheckedCreateNestedManyWithoutTaskInput = {
    create?: XOR<TaskDiffCreateWithoutTaskInput, TaskDiffUncheckedCreateWithoutTaskInput> | TaskDiffCreateWithoutTaskInput[] | TaskDiffUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskDiffCreateOrConnectWithoutTaskInput | TaskDiffCreateOrConnectWithoutTaskInput[]
    createMany?: TaskDiffCreateManyTaskInputEnvelope
    connect?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
  }

  export type AgentRunUncheckedCreateNestedManyWithoutTaskInput = {
    create?: XOR<AgentRunCreateWithoutTaskInput, AgentRunUncheckedCreateWithoutTaskInput> | AgentRunCreateWithoutTaskInput[] | AgentRunUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutTaskInput | AgentRunCreateOrConnectWithoutTaskInput[]
    createMany?: AgentRunCreateManyTaskInputEnvelope
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
  }

  export type TraceSpanUncheckedCreateNestedManyWithoutTaskInput = {
    create?: XOR<TraceSpanCreateWithoutTaskInput, TraceSpanUncheckedCreateWithoutTaskInput> | TraceSpanCreateWithoutTaskInput[] | TraceSpanUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TraceSpanCreateOrConnectWithoutTaskInput | TraceSpanCreateOrConnectWithoutTaskInput[]
    createMany?: TraceSpanCreateManyTaskInputEnvelope
    connect?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
  }

  export type ProjectUpdateOneRequiredWithoutTasksNestedInput = {
    create?: XOR<ProjectCreateWithoutTasksInput, ProjectUncheckedCreateWithoutTasksInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutTasksInput
    upsert?: ProjectUpsertWithoutTasksInput
    connect?: ProjectWhereUniqueInput
    update?: XOR<XOR<ProjectUpdateToOneWithWhereWithoutTasksInput, ProjectUpdateWithoutTasksInput>, ProjectUncheckedUpdateWithoutTasksInput>
  }

  export type TaskStepUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TaskStepCreateWithoutTaskInput, TaskStepUncheckedCreateWithoutTaskInput> | TaskStepCreateWithoutTaskInput[] | TaskStepUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskStepCreateOrConnectWithoutTaskInput | TaskStepCreateOrConnectWithoutTaskInput[]
    upsert?: TaskStepUpsertWithWhereUniqueWithoutTaskInput | TaskStepUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TaskStepCreateManyTaskInputEnvelope
    set?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    disconnect?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    delete?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    connect?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    update?: TaskStepUpdateWithWhereUniqueWithoutTaskInput | TaskStepUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TaskStepUpdateManyWithWhereWithoutTaskInput | TaskStepUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TaskStepScalarWhereInput | TaskStepScalarWhereInput[]
  }

  export type TaskTraceUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TaskTraceCreateWithoutTaskInput, TaskTraceUncheckedCreateWithoutTaskInput> | TaskTraceCreateWithoutTaskInput[] | TaskTraceUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskTraceCreateOrConnectWithoutTaskInput | TaskTraceCreateOrConnectWithoutTaskInput[]
    upsert?: TaskTraceUpsertWithWhereUniqueWithoutTaskInput | TaskTraceUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TaskTraceCreateManyTaskInputEnvelope
    set?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    disconnect?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    delete?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    connect?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    update?: TaskTraceUpdateWithWhereUniqueWithoutTaskInput | TaskTraceUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TaskTraceUpdateManyWithWhereWithoutTaskInput | TaskTraceUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TaskTraceScalarWhereInput | TaskTraceScalarWhereInput[]
  }

  export type TaskDiffUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TaskDiffCreateWithoutTaskInput, TaskDiffUncheckedCreateWithoutTaskInput> | TaskDiffCreateWithoutTaskInput[] | TaskDiffUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskDiffCreateOrConnectWithoutTaskInput | TaskDiffCreateOrConnectWithoutTaskInput[]
    upsert?: TaskDiffUpsertWithWhereUniqueWithoutTaskInput | TaskDiffUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TaskDiffCreateManyTaskInputEnvelope
    set?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    disconnect?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    delete?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    connect?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    update?: TaskDiffUpdateWithWhereUniqueWithoutTaskInput | TaskDiffUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TaskDiffUpdateManyWithWhereWithoutTaskInput | TaskDiffUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TaskDiffScalarWhereInput | TaskDiffScalarWhereInput[]
  }

  export type AgentRunUpdateManyWithoutTaskNestedInput = {
    create?: XOR<AgentRunCreateWithoutTaskInput, AgentRunUncheckedCreateWithoutTaskInput> | AgentRunCreateWithoutTaskInput[] | AgentRunUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutTaskInput | AgentRunCreateOrConnectWithoutTaskInput[]
    upsert?: AgentRunUpsertWithWhereUniqueWithoutTaskInput | AgentRunUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: AgentRunCreateManyTaskInputEnvelope
    set?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    disconnect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    delete?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    update?: AgentRunUpdateWithWhereUniqueWithoutTaskInput | AgentRunUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: AgentRunUpdateManyWithWhereWithoutTaskInput | AgentRunUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
  }

  export type TraceSpanUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TraceSpanCreateWithoutTaskInput, TraceSpanUncheckedCreateWithoutTaskInput> | TraceSpanCreateWithoutTaskInput[] | TraceSpanUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TraceSpanCreateOrConnectWithoutTaskInput | TraceSpanCreateOrConnectWithoutTaskInput[]
    upsert?: TraceSpanUpsertWithWhereUniqueWithoutTaskInput | TraceSpanUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TraceSpanCreateManyTaskInputEnvelope
    set?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    disconnect?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    delete?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    connect?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    update?: TraceSpanUpdateWithWhereUniqueWithoutTaskInput | TraceSpanUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TraceSpanUpdateManyWithWhereWithoutTaskInput | TraceSpanUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TraceSpanScalarWhereInput | TraceSpanScalarWhereInput[]
  }

  export type TaskStepUncheckedUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TaskStepCreateWithoutTaskInput, TaskStepUncheckedCreateWithoutTaskInput> | TaskStepCreateWithoutTaskInput[] | TaskStepUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskStepCreateOrConnectWithoutTaskInput | TaskStepCreateOrConnectWithoutTaskInput[]
    upsert?: TaskStepUpsertWithWhereUniqueWithoutTaskInput | TaskStepUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TaskStepCreateManyTaskInputEnvelope
    set?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    disconnect?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    delete?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    connect?: TaskStepWhereUniqueInput | TaskStepWhereUniqueInput[]
    update?: TaskStepUpdateWithWhereUniqueWithoutTaskInput | TaskStepUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TaskStepUpdateManyWithWhereWithoutTaskInput | TaskStepUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TaskStepScalarWhereInput | TaskStepScalarWhereInput[]
  }

  export type TaskTraceUncheckedUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TaskTraceCreateWithoutTaskInput, TaskTraceUncheckedCreateWithoutTaskInput> | TaskTraceCreateWithoutTaskInput[] | TaskTraceUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskTraceCreateOrConnectWithoutTaskInput | TaskTraceCreateOrConnectWithoutTaskInput[]
    upsert?: TaskTraceUpsertWithWhereUniqueWithoutTaskInput | TaskTraceUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TaskTraceCreateManyTaskInputEnvelope
    set?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    disconnect?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    delete?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    connect?: TaskTraceWhereUniqueInput | TaskTraceWhereUniqueInput[]
    update?: TaskTraceUpdateWithWhereUniqueWithoutTaskInput | TaskTraceUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TaskTraceUpdateManyWithWhereWithoutTaskInput | TaskTraceUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TaskTraceScalarWhereInput | TaskTraceScalarWhereInput[]
  }

  export type TaskDiffUncheckedUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TaskDiffCreateWithoutTaskInput, TaskDiffUncheckedCreateWithoutTaskInput> | TaskDiffCreateWithoutTaskInput[] | TaskDiffUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TaskDiffCreateOrConnectWithoutTaskInput | TaskDiffCreateOrConnectWithoutTaskInput[]
    upsert?: TaskDiffUpsertWithWhereUniqueWithoutTaskInput | TaskDiffUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TaskDiffCreateManyTaskInputEnvelope
    set?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    disconnect?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    delete?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    connect?: TaskDiffWhereUniqueInput | TaskDiffWhereUniqueInput[]
    update?: TaskDiffUpdateWithWhereUniqueWithoutTaskInput | TaskDiffUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TaskDiffUpdateManyWithWhereWithoutTaskInput | TaskDiffUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TaskDiffScalarWhereInput | TaskDiffScalarWhereInput[]
  }

  export type AgentRunUncheckedUpdateManyWithoutTaskNestedInput = {
    create?: XOR<AgentRunCreateWithoutTaskInput, AgentRunUncheckedCreateWithoutTaskInput> | AgentRunCreateWithoutTaskInput[] | AgentRunUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: AgentRunCreateOrConnectWithoutTaskInput | AgentRunCreateOrConnectWithoutTaskInput[]
    upsert?: AgentRunUpsertWithWhereUniqueWithoutTaskInput | AgentRunUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: AgentRunCreateManyTaskInputEnvelope
    set?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    disconnect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    delete?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    connect?: AgentRunWhereUniqueInput | AgentRunWhereUniqueInput[]
    update?: AgentRunUpdateWithWhereUniqueWithoutTaskInput | AgentRunUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: AgentRunUpdateManyWithWhereWithoutTaskInput | AgentRunUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
  }

  export type TraceSpanUncheckedUpdateManyWithoutTaskNestedInput = {
    create?: XOR<TraceSpanCreateWithoutTaskInput, TraceSpanUncheckedCreateWithoutTaskInput> | TraceSpanCreateWithoutTaskInput[] | TraceSpanUncheckedCreateWithoutTaskInput[]
    connectOrCreate?: TraceSpanCreateOrConnectWithoutTaskInput | TraceSpanCreateOrConnectWithoutTaskInput[]
    upsert?: TraceSpanUpsertWithWhereUniqueWithoutTaskInput | TraceSpanUpsertWithWhereUniqueWithoutTaskInput[]
    createMany?: TraceSpanCreateManyTaskInputEnvelope
    set?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    disconnect?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    delete?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    connect?: TraceSpanWhereUniqueInput | TraceSpanWhereUniqueInput[]
    update?: TraceSpanUpdateWithWhereUniqueWithoutTaskInput | TraceSpanUpdateWithWhereUniqueWithoutTaskInput[]
    updateMany?: TraceSpanUpdateManyWithWhereWithoutTaskInput | TraceSpanUpdateManyWithWhereWithoutTaskInput[]
    deleteMany?: TraceSpanScalarWhereInput | TraceSpanScalarWhereInput[]
  }

  export type TaskCreateNestedOneWithoutStepsInput = {
    create?: XOR<TaskCreateWithoutStepsInput, TaskUncheckedCreateWithoutStepsInput>
    connectOrCreate?: TaskCreateOrConnectWithoutStepsInput
    connect?: TaskWhereUniqueInput
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type TaskUpdateOneRequiredWithoutStepsNestedInput = {
    create?: XOR<TaskCreateWithoutStepsInput, TaskUncheckedCreateWithoutStepsInput>
    connectOrCreate?: TaskCreateOrConnectWithoutStepsInput
    upsert?: TaskUpsertWithoutStepsInput
    connect?: TaskWhereUniqueInput
    update?: XOR<XOR<TaskUpdateToOneWithWhereWithoutStepsInput, TaskUpdateWithoutStepsInput>, TaskUncheckedUpdateWithoutStepsInput>
  }

  export type TaskCreateNestedOneWithoutTracesInput = {
    create?: XOR<TaskCreateWithoutTracesInput, TaskUncheckedCreateWithoutTracesInput>
    connectOrCreate?: TaskCreateOrConnectWithoutTracesInput
    connect?: TaskWhereUniqueInput
  }

  export type TaskUpdateOneRequiredWithoutTracesNestedInput = {
    create?: XOR<TaskCreateWithoutTracesInput, TaskUncheckedCreateWithoutTracesInput>
    connectOrCreate?: TaskCreateOrConnectWithoutTracesInput
    upsert?: TaskUpsertWithoutTracesInput
    connect?: TaskWhereUniqueInput
    update?: XOR<XOR<TaskUpdateToOneWithWhereWithoutTracesInput, TaskUpdateWithoutTracesInput>, TaskUncheckedUpdateWithoutTracesInput>
  }

  export type TaskCreateNestedOneWithoutDiffsInput = {
    create?: XOR<TaskCreateWithoutDiffsInput, TaskUncheckedCreateWithoutDiffsInput>
    connectOrCreate?: TaskCreateOrConnectWithoutDiffsInput
    connect?: TaskWhereUniqueInput
  }

  export type TaskUpdateOneRequiredWithoutDiffsNestedInput = {
    create?: XOR<TaskCreateWithoutDiffsInput, TaskUncheckedCreateWithoutDiffsInput>
    connectOrCreate?: TaskCreateOrConnectWithoutDiffsInput
    upsert?: TaskUpsertWithoutDiffsInput
    connect?: TaskWhereUniqueInput
    update?: XOR<XOR<TaskUpdateToOneWithWhereWithoutDiffsInput, TaskUpdateWithoutDiffsInput>, TaskUncheckedUpdateWithoutDiffsInput>
  }

  export type TaskCreateNestedOneWithoutAgentRunsInput = {
    create?: XOR<TaskCreateWithoutAgentRunsInput, TaskUncheckedCreateWithoutAgentRunsInput>
    connectOrCreate?: TaskCreateOrConnectWithoutAgentRunsInput
    connect?: TaskWhereUniqueInput
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type TaskUpdateOneRequiredWithoutAgentRunsNestedInput = {
    create?: XOR<TaskCreateWithoutAgentRunsInput, TaskUncheckedCreateWithoutAgentRunsInput>
    connectOrCreate?: TaskCreateOrConnectWithoutAgentRunsInput
    upsert?: TaskUpsertWithoutAgentRunsInput
    connect?: TaskWhereUniqueInput
    update?: XOR<XOR<TaskUpdateToOneWithWhereWithoutAgentRunsInput, TaskUpdateWithoutAgentRunsInput>, TaskUncheckedUpdateWithoutAgentRunsInput>
  }

  export type TaskCreateNestedOneWithoutTraceSpansInput = {
    create?: XOR<TaskCreateWithoutTraceSpansInput, TaskUncheckedCreateWithoutTraceSpansInput>
    connectOrCreate?: TaskCreateOrConnectWithoutTraceSpansInput
    connect?: TaskWhereUniqueInput
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type TaskUpdateOneWithoutTraceSpansNestedInput = {
    create?: XOR<TaskCreateWithoutTraceSpansInput, TaskUncheckedCreateWithoutTraceSpansInput>
    connectOrCreate?: TaskCreateOrConnectWithoutTraceSpansInput
    upsert?: TaskUpsertWithoutTraceSpansInput
    disconnect?: TaskWhereInput | boolean
    delete?: TaskWhereInput | boolean
    connect?: TaskWhereUniqueInput
    update?: XOR<XOR<TaskUpdateToOneWithWhereWithoutTraceSpansInput, TaskUpdateWithoutTraceSpansInput>, TaskUncheckedUpdateWithoutTraceSpansInput>
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type TaskCreateWithoutProjectInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepCreateNestedManyWithoutTaskInput
    traces?: TaskTraceCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateWithoutProjectInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepUncheckedCreateNestedManyWithoutTaskInput
    traces?: TaskTraceUncheckedCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffUncheckedCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskCreateOrConnectWithoutProjectInput = {
    where: TaskWhereUniqueInput
    create: XOR<TaskCreateWithoutProjectInput, TaskUncheckedCreateWithoutProjectInput>
  }

  export type TaskCreateManyProjectInputEnvelope = {
    data: TaskCreateManyProjectInput | TaskCreateManyProjectInput[]
    skipDuplicates?: boolean
  }

  export type TaskUpsertWithWhereUniqueWithoutProjectInput = {
    where: TaskWhereUniqueInput
    update: XOR<TaskUpdateWithoutProjectInput, TaskUncheckedUpdateWithoutProjectInput>
    create: XOR<TaskCreateWithoutProjectInput, TaskUncheckedCreateWithoutProjectInput>
  }

  export type TaskUpdateWithWhereUniqueWithoutProjectInput = {
    where: TaskWhereUniqueInput
    data: XOR<TaskUpdateWithoutProjectInput, TaskUncheckedUpdateWithoutProjectInput>
  }

  export type TaskUpdateManyWithWhereWithoutProjectInput = {
    where: TaskScalarWhereInput
    data: XOR<TaskUpdateManyMutationInput, TaskUncheckedUpdateManyWithoutProjectInput>
  }

  export type TaskScalarWhereInput = {
    AND?: TaskScalarWhereInput | TaskScalarWhereInput[]
    OR?: TaskScalarWhereInput[]
    NOT?: TaskScalarWhereInput | TaskScalarWhereInput[]
    id?: StringFilter<"Task"> | string
    projectId?: StringFilter<"Task"> | string
    title?: StringFilter<"Task"> | string
    description?: StringNullableFilter<"Task"> | string | null
    status?: StringFilter<"Task"> | string
    complexity?: StringFilter<"Task"> | string
    tags?: StringNullableFilter<"Task"> | string | null
    provider?: StringNullableFilter<"Task"> | string | null
    model?: StringNullableFilter<"Task"> | string | null
    result?: StringNullableFilter<"Task"> | string | null
    error?: StringNullableFilter<"Task"> | string | null
    createdAt?: DateTimeFilter<"Task"> | Date | string
    updatedAt?: DateTimeFilter<"Task"> | Date | string
  }

  export type ProjectCreateWithoutTasksInput = {
    id?: string
    name: string
    path: string
    repoUrl?: string | null
    description?: string | null
    env?: string | null
    createdAt?: Date | string
  }

  export type ProjectUncheckedCreateWithoutTasksInput = {
    id?: string
    name: string
    path: string
    repoUrl?: string | null
    description?: string | null
    env?: string | null
    createdAt?: Date | string
  }

  export type ProjectCreateOrConnectWithoutTasksInput = {
    where: ProjectWhereUniqueInput
    create: XOR<ProjectCreateWithoutTasksInput, ProjectUncheckedCreateWithoutTasksInput>
  }

  export type TaskStepCreateWithoutTaskInput = {
    id?: string
    idx: number
    name: string
    status?: string
    input?: string | null
    output?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskStepUncheckedCreateWithoutTaskInput = {
    id?: string
    idx: number
    name: string
    status?: string
    input?: string | null
    output?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskStepCreateOrConnectWithoutTaskInput = {
    where: TaskStepWhereUniqueInput
    create: XOR<TaskStepCreateWithoutTaskInput, TaskStepUncheckedCreateWithoutTaskInput>
  }

  export type TaskStepCreateManyTaskInputEnvelope = {
    data: TaskStepCreateManyTaskInput | TaskStepCreateManyTaskInput[]
    skipDuplicates?: boolean
  }

  export type TaskTraceCreateWithoutTaskInput = {
    id?: string
    stepId?: string | null
    role: string
    content?: string | null
    toolCalls?: string | null
    createdAt?: Date | string
  }

  export type TaskTraceUncheckedCreateWithoutTaskInput = {
    id?: string
    stepId?: string | null
    role: string
    content?: string | null
    toolCalls?: string | null
    createdAt?: Date | string
  }

  export type TaskTraceCreateOrConnectWithoutTaskInput = {
    where: TaskTraceWhereUniqueInput
    create: XOR<TaskTraceCreateWithoutTaskInput, TaskTraceUncheckedCreateWithoutTaskInput>
  }

  export type TaskTraceCreateManyTaskInputEnvelope = {
    data: TaskTraceCreateManyTaskInput | TaskTraceCreateManyTaskInput[]
    skipDuplicates?: boolean
  }

  export type TaskDiffCreateWithoutTaskInput = {
    id?: string
    branch: string
    commitSha?: string | null
    patch: string
    createdAt?: Date | string
  }

  export type TaskDiffUncheckedCreateWithoutTaskInput = {
    id?: string
    branch: string
    commitSha?: string | null
    patch: string
    createdAt?: Date | string
  }

  export type TaskDiffCreateOrConnectWithoutTaskInput = {
    where: TaskDiffWhereUniqueInput
    create: XOR<TaskDiffCreateWithoutTaskInput, TaskDiffUncheckedCreateWithoutTaskInput>
  }

  export type TaskDiffCreateManyTaskInputEnvelope = {
    data: TaskDiffCreateManyTaskInput | TaskDiffCreateManyTaskInput[]
    skipDuplicates?: boolean
  }

  export type AgentRunCreateWithoutTaskInput = {
    id?: string
    branch: string
    baseCommit: string
    resultStatus?: string
    validationSummary?: string | null
    publishedVersion?: string | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunUncheckedCreateWithoutTaskInput = {
    id?: string
    branch: string
    baseCommit: string
    resultStatus?: string
    validationSummary?: string | null
    publishedVersion?: string | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentRunCreateOrConnectWithoutTaskInput = {
    where: AgentRunWhereUniqueInput
    create: XOR<AgentRunCreateWithoutTaskInput, AgentRunUncheckedCreateWithoutTaskInput>
  }

  export type AgentRunCreateManyTaskInputEnvelope = {
    data: AgentRunCreateManyTaskInput | AgentRunCreateManyTaskInput[]
    skipDuplicates?: boolean
  }

  export type TraceSpanCreateWithoutTaskInput = {
    id?: string
    traceId: string
    spanId: string
    parentId?: string | null
    name: string
    startTime?: Date | string
    endTime?: Date | string | null
    status?: string
    attributes?: string | null
    events?: string | null
  }

  export type TraceSpanUncheckedCreateWithoutTaskInput = {
    id?: string
    traceId: string
    spanId: string
    parentId?: string | null
    name: string
    startTime?: Date | string
    endTime?: Date | string | null
    status?: string
    attributes?: string | null
    events?: string | null
  }

  export type TraceSpanCreateOrConnectWithoutTaskInput = {
    where: TraceSpanWhereUniqueInput
    create: XOR<TraceSpanCreateWithoutTaskInput, TraceSpanUncheckedCreateWithoutTaskInput>
  }

  export type TraceSpanCreateManyTaskInputEnvelope = {
    data: TraceSpanCreateManyTaskInput | TraceSpanCreateManyTaskInput[]
    skipDuplicates?: boolean
  }

  export type ProjectUpsertWithoutTasksInput = {
    update: XOR<ProjectUpdateWithoutTasksInput, ProjectUncheckedUpdateWithoutTasksInput>
    create: XOR<ProjectCreateWithoutTasksInput, ProjectUncheckedCreateWithoutTasksInput>
    where?: ProjectWhereInput
  }

  export type ProjectUpdateToOneWithWhereWithoutTasksInput = {
    where?: ProjectWhereInput
    data: XOR<ProjectUpdateWithoutTasksInput, ProjectUncheckedUpdateWithoutTasksInput>
  }

  export type ProjectUpdateWithoutTasksInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    repoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    env?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectUncheckedUpdateWithoutTasksInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    path?: StringFieldUpdateOperationsInput | string
    repoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    env?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepUpsertWithWhereUniqueWithoutTaskInput = {
    where: TaskStepWhereUniqueInput
    update: XOR<TaskStepUpdateWithoutTaskInput, TaskStepUncheckedUpdateWithoutTaskInput>
    create: XOR<TaskStepCreateWithoutTaskInput, TaskStepUncheckedCreateWithoutTaskInput>
  }

  export type TaskStepUpdateWithWhereUniqueWithoutTaskInput = {
    where: TaskStepWhereUniqueInput
    data: XOR<TaskStepUpdateWithoutTaskInput, TaskStepUncheckedUpdateWithoutTaskInput>
  }

  export type TaskStepUpdateManyWithWhereWithoutTaskInput = {
    where: TaskStepScalarWhereInput
    data: XOR<TaskStepUpdateManyMutationInput, TaskStepUncheckedUpdateManyWithoutTaskInput>
  }

  export type TaskStepScalarWhereInput = {
    AND?: TaskStepScalarWhereInput | TaskStepScalarWhereInput[]
    OR?: TaskStepScalarWhereInput[]
    NOT?: TaskStepScalarWhereInput | TaskStepScalarWhereInput[]
    id?: StringFilter<"TaskStep"> | string
    taskId?: StringFilter<"TaskStep"> | string
    idx?: IntFilter<"TaskStep"> | number
    name?: StringFilter<"TaskStep"> | string
    status?: StringFilter<"TaskStep"> | string
    input?: StringNullableFilter<"TaskStep"> | string | null
    output?: StringNullableFilter<"TaskStep"> | string | null
    error?: StringNullableFilter<"TaskStep"> | string | null
    createdAt?: DateTimeFilter<"TaskStep"> | Date | string
    updatedAt?: DateTimeFilter<"TaskStep"> | Date | string
  }

  export type TaskTraceUpsertWithWhereUniqueWithoutTaskInput = {
    where: TaskTraceWhereUniqueInput
    update: XOR<TaskTraceUpdateWithoutTaskInput, TaskTraceUncheckedUpdateWithoutTaskInput>
    create: XOR<TaskTraceCreateWithoutTaskInput, TaskTraceUncheckedCreateWithoutTaskInput>
  }

  export type TaskTraceUpdateWithWhereUniqueWithoutTaskInput = {
    where: TaskTraceWhereUniqueInput
    data: XOR<TaskTraceUpdateWithoutTaskInput, TaskTraceUncheckedUpdateWithoutTaskInput>
  }

  export type TaskTraceUpdateManyWithWhereWithoutTaskInput = {
    where: TaskTraceScalarWhereInput
    data: XOR<TaskTraceUpdateManyMutationInput, TaskTraceUncheckedUpdateManyWithoutTaskInput>
  }

  export type TaskTraceScalarWhereInput = {
    AND?: TaskTraceScalarWhereInput | TaskTraceScalarWhereInput[]
    OR?: TaskTraceScalarWhereInput[]
    NOT?: TaskTraceScalarWhereInput | TaskTraceScalarWhereInput[]
    id?: StringFilter<"TaskTrace"> | string
    taskId?: StringFilter<"TaskTrace"> | string
    stepId?: StringNullableFilter<"TaskTrace"> | string | null
    role?: StringFilter<"TaskTrace"> | string
    content?: StringNullableFilter<"TaskTrace"> | string | null
    toolCalls?: StringNullableFilter<"TaskTrace"> | string | null
    createdAt?: DateTimeFilter<"TaskTrace"> | Date | string
  }

  export type TaskDiffUpsertWithWhereUniqueWithoutTaskInput = {
    where: TaskDiffWhereUniqueInput
    update: XOR<TaskDiffUpdateWithoutTaskInput, TaskDiffUncheckedUpdateWithoutTaskInput>
    create: XOR<TaskDiffCreateWithoutTaskInput, TaskDiffUncheckedCreateWithoutTaskInput>
  }

  export type TaskDiffUpdateWithWhereUniqueWithoutTaskInput = {
    where: TaskDiffWhereUniqueInput
    data: XOR<TaskDiffUpdateWithoutTaskInput, TaskDiffUncheckedUpdateWithoutTaskInput>
  }

  export type TaskDiffUpdateManyWithWhereWithoutTaskInput = {
    where: TaskDiffScalarWhereInput
    data: XOR<TaskDiffUpdateManyMutationInput, TaskDiffUncheckedUpdateManyWithoutTaskInput>
  }

  export type TaskDiffScalarWhereInput = {
    AND?: TaskDiffScalarWhereInput | TaskDiffScalarWhereInput[]
    OR?: TaskDiffScalarWhereInput[]
    NOT?: TaskDiffScalarWhereInput | TaskDiffScalarWhereInput[]
    id?: StringFilter<"TaskDiff"> | string
    taskId?: StringFilter<"TaskDiff"> | string
    branch?: StringFilter<"TaskDiff"> | string
    commitSha?: StringNullableFilter<"TaskDiff"> | string | null
    patch?: StringFilter<"TaskDiff"> | string
    createdAt?: DateTimeFilter<"TaskDiff"> | Date | string
  }

  export type AgentRunUpsertWithWhereUniqueWithoutTaskInput = {
    where: AgentRunWhereUniqueInput
    update: XOR<AgentRunUpdateWithoutTaskInput, AgentRunUncheckedUpdateWithoutTaskInput>
    create: XOR<AgentRunCreateWithoutTaskInput, AgentRunUncheckedCreateWithoutTaskInput>
  }

  export type AgentRunUpdateWithWhereUniqueWithoutTaskInput = {
    where: AgentRunWhereUniqueInput
    data: XOR<AgentRunUpdateWithoutTaskInput, AgentRunUncheckedUpdateWithoutTaskInput>
  }

  export type AgentRunUpdateManyWithWhereWithoutTaskInput = {
    where: AgentRunScalarWhereInput
    data: XOR<AgentRunUpdateManyMutationInput, AgentRunUncheckedUpdateManyWithoutTaskInput>
  }

  export type AgentRunScalarWhereInput = {
    AND?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
    OR?: AgentRunScalarWhereInput[]
    NOT?: AgentRunScalarWhereInput | AgentRunScalarWhereInput[]
    id?: StringFilter<"AgentRun"> | string
    taskId?: StringFilter<"AgentRun"> | string
    branch?: StringFilter<"AgentRun"> | string
    baseCommit?: StringFilter<"AgentRun"> | string
    resultStatus?: StringFilter<"AgentRun"> | string
    validationSummary?: StringNullableFilter<"AgentRun"> | string | null
    publishedVersion?: StringNullableFilter<"AgentRun"> | string | null
    promptTokens?: IntNullableFilter<"AgentRun"> | number | null
    completionTokens?: IntNullableFilter<"AgentRun"> | number | null
    totalTokens?: IntNullableFilter<"AgentRun"> | number | null
    createdAt?: DateTimeFilter<"AgentRun"> | Date | string
    updatedAt?: DateTimeFilter<"AgentRun"> | Date | string
  }

  export type TraceSpanUpsertWithWhereUniqueWithoutTaskInput = {
    where: TraceSpanWhereUniqueInput
    update: XOR<TraceSpanUpdateWithoutTaskInput, TraceSpanUncheckedUpdateWithoutTaskInput>
    create: XOR<TraceSpanCreateWithoutTaskInput, TraceSpanUncheckedCreateWithoutTaskInput>
  }

  export type TraceSpanUpdateWithWhereUniqueWithoutTaskInput = {
    where: TraceSpanWhereUniqueInput
    data: XOR<TraceSpanUpdateWithoutTaskInput, TraceSpanUncheckedUpdateWithoutTaskInput>
  }

  export type TraceSpanUpdateManyWithWhereWithoutTaskInput = {
    where: TraceSpanScalarWhereInput
    data: XOR<TraceSpanUpdateManyMutationInput, TraceSpanUncheckedUpdateManyWithoutTaskInput>
  }

  export type TraceSpanScalarWhereInput = {
    AND?: TraceSpanScalarWhereInput | TraceSpanScalarWhereInput[]
    OR?: TraceSpanScalarWhereInput[]
    NOT?: TraceSpanScalarWhereInput | TraceSpanScalarWhereInput[]
    id?: StringFilter<"TraceSpan"> | string
    traceId?: StringFilter<"TraceSpan"> | string
    spanId?: StringFilter<"TraceSpan"> | string
    parentId?: StringNullableFilter<"TraceSpan"> | string | null
    taskId?: StringNullableFilter<"TraceSpan"> | string | null
    name?: StringFilter<"TraceSpan"> | string
    startTime?: DateTimeFilter<"TraceSpan"> | Date | string
    endTime?: DateTimeNullableFilter<"TraceSpan"> | Date | string | null
    status?: StringFilter<"TraceSpan"> | string
    attributes?: StringNullableFilter<"TraceSpan"> | string | null
    events?: StringNullableFilter<"TraceSpan"> | string | null
  }

  export type TaskCreateWithoutStepsInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutTasksInput
    traces?: TaskTraceCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateWithoutStepsInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    traces?: TaskTraceUncheckedCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffUncheckedCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskCreateOrConnectWithoutStepsInput = {
    where: TaskWhereUniqueInput
    create: XOR<TaskCreateWithoutStepsInput, TaskUncheckedCreateWithoutStepsInput>
  }

  export type TaskUpsertWithoutStepsInput = {
    update: XOR<TaskUpdateWithoutStepsInput, TaskUncheckedUpdateWithoutStepsInput>
    create: XOR<TaskCreateWithoutStepsInput, TaskUncheckedCreateWithoutStepsInput>
    where?: TaskWhereInput
  }

  export type TaskUpdateToOneWithWhereWithoutStepsInput = {
    where?: TaskWhereInput
    data: XOR<TaskUpdateWithoutStepsInput, TaskUncheckedUpdateWithoutStepsInput>
  }

  export type TaskUpdateWithoutStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutTasksNestedInput
    traces?: TaskTraceUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateWithoutStepsInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    traces?: TaskTraceUncheckedUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUncheckedUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskCreateWithoutTracesInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutTasksInput
    steps?: TaskStepCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateWithoutTracesInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepUncheckedCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffUncheckedCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskCreateOrConnectWithoutTracesInput = {
    where: TaskWhereUniqueInput
    create: XOR<TaskCreateWithoutTracesInput, TaskUncheckedCreateWithoutTracesInput>
  }

  export type TaskUpsertWithoutTracesInput = {
    update: XOR<TaskUpdateWithoutTracesInput, TaskUncheckedUpdateWithoutTracesInput>
    create: XOR<TaskCreateWithoutTracesInput, TaskUncheckedCreateWithoutTracesInput>
    where?: TaskWhereInput
  }

  export type TaskUpdateToOneWithWhereWithoutTracesInput = {
    where?: TaskWhereInput
    data: XOR<TaskUpdateWithoutTracesInput, TaskUncheckedUpdateWithoutTracesInput>
  }

  export type TaskUpdateWithoutTracesInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutTasksNestedInput
    steps?: TaskStepUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateWithoutTracesInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUncheckedUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUncheckedUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskCreateWithoutDiffsInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutTasksInput
    steps?: TaskStepCreateNestedManyWithoutTaskInput
    traces?: TaskTraceCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateWithoutDiffsInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepUncheckedCreateNestedManyWithoutTaskInput
    traces?: TaskTraceUncheckedCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskCreateOrConnectWithoutDiffsInput = {
    where: TaskWhereUniqueInput
    create: XOR<TaskCreateWithoutDiffsInput, TaskUncheckedCreateWithoutDiffsInput>
  }

  export type TaskUpsertWithoutDiffsInput = {
    update: XOR<TaskUpdateWithoutDiffsInput, TaskUncheckedUpdateWithoutDiffsInput>
    create: XOR<TaskCreateWithoutDiffsInput, TaskUncheckedCreateWithoutDiffsInput>
    where?: TaskWhereInput
  }

  export type TaskUpdateToOneWithWhereWithoutDiffsInput = {
    where?: TaskWhereInput
    data: XOR<TaskUpdateWithoutDiffsInput, TaskUncheckedUpdateWithoutDiffsInput>
  }

  export type TaskUpdateWithoutDiffsInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutTasksNestedInput
    steps?: TaskStepUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateWithoutDiffsInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUncheckedUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUncheckedUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskCreateWithoutAgentRunsInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutTasksInput
    steps?: TaskStepCreateNestedManyWithoutTaskInput
    traces?: TaskTraceCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateWithoutAgentRunsInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepUncheckedCreateNestedManyWithoutTaskInput
    traces?: TaskTraceUncheckedCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffUncheckedCreateNestedManyWithoutTaskInput
    traceSpans?: TraceSpanUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskCreateOrConnectWithoutAgentRunsInput = {
    where: TaskWhereUniqueInput
    create: XOR<TaskCreateWithoutAgentRunsInput, TaskUncheckedCreateWithoutAgentRunsInput>
  }

  export type TaskUpsertWithoutAgentRunsInput = {
    update: XOR<TaskUpdateWithoutAgentRunsInput, TaskUncheckedUpdateWithoutAgentRunsInput>
    create: XOR<TaskCreateWithoutAgentRunsInput, TaskUncheckedCreateWithoutAgentRunsInput>
    where?: TaskWhereInput
  }

  export type TaskUpdateToOneWithWhereWithoutAgentRunsInput = {
    where?: TaskWhereInput
    data: XOR<TaskUpdateWithoutAgentRunsInput, TaskUncheckedUpdateWithoutAgentRunsInput>
  }

  export type TaskUpdateWithoutAgentRunsInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutTasksNestedInput
    steps?: TaskStepUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateWithoutAgentRunsInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUncheckedUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUncheckedUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUncheckedUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskCreateWithoutTraceSpansInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutTasksInput
    steps?: TaskStepCreateNestedManyWithoutTaskInput
    traces?: TaskTraceCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunCreateNestedManyWithoutTaskInput
  }

  export type TaskUncheckedCreateWithoutTraceSpansInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    steps?: TaskStepUncheckedCreateNestedManyWithoutTaskInput
    traces?: TaskTraceUncheckedCreateNestedManyWithoutTaskInput
    diffs?: TaskDiffUncheckedCreateNestedManyWithoutTaskInput
    agentRuns?: AgentRunUncheckedCreateNestedManyWithoutTaskInput
  }

  export type TaskCreateOrConnectWithoutTraceSpansInput = {
    where: TaskWhereUniqueInput
    create: XOR<TaskCreateWithoutTraceSpansInput, TaskUncheckedCreateWithoutTraceSpansInput>
  }

  export type TaskUpsertWithoutTraceSpansInput = {
    update: XOR<TaskUpdateWithoutTraceSpansInput, TaskUncheckedUpdateWithoutTraceSpansInput>
    create: XOR<TaskCreateWithoutTraceSpansInput, TaskUncheckedCreateWithoutTraceSpansInput>
    where?: TaskWhereInput
  }

  export type TaskUpdateToOneWithWhereWithoutTraceSpansInput = {
    where?: TaskWhereInput
    data: XOR<TaskUpdateWithoutTraceSpansInput, TaskUncheckedUpdateWithoutTraceSpansInput>
  }

  export type TaskUpdateWithoutTraceSpansInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutTasksNestedInput
    steps?: TaskStepUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateWithoutTraceSpansInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUncheckedUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUncheckedUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUncheckedUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskCreateManyProjectInput = {
    id?: string
    title: string
    description?: string | null
    status?: string
    complexity?: string
    tags?: string | null
    provider?: string | null
    model?: string | null
    result?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskUpdateWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    steps?: TaskStepUncheckedUpdateManyWithoutTaskNestedInput
    traces?: TaskTraceUncheckedUpdateManyWithoutTaskNestedInput
    diffs?: TaskDiffUncheckedUpdateManyWithoutTaskNestedInput
    agentRuns?: AgentRunUncheckedUpdateManyWithoutTaskNestedInput
    traceSpans?: TraceSpanUncheckedUpdateManyWithoutTaskNestedInput
  }

  export type TaskUncheckedUpdateManyWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    complexity?: StringFieldUpdateOperationsInput | string
    tags?: NullableStringFieldUpdateOperationsInput | string | null
    provider?: NullableStringFieldUpdateOperationsInput | string | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    result?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepCreateManyTaskInput = {
    id?: string
    idx: number
    name: string
    status?: string
    input?: string | null
    output?: string | null
    error?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TaskTraceCreateManyTaskInput = {
    id?: string
    stepId?: string | null
    role: string
    content?: string | null
    toolCalls?: string | null
    createdAt?: Date | string
  }

  export type TaskDiffCreateManyTaskInput = {
    id?: string
    branch: string
    commitSha?: string | null
    patch: string
    createdAt?: Date | string
  }

  export type AgentRunCreateManyTaskInput = {
    id?: string
    branch: string
    baseCommit: string
    resultStatus?: string
    validationSummary?: string | null
    publishedVersion?: string | null
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TraceSpanCreateManyTaskInput = {
    id?: string
    traceId: string
    spanId: string
    parentId?: string | null
    name: string
    startTime?: Date | string
    endTime?: Date | string | null
    status?: string
    attributes?: string | null
    events?: string | null
  }

  export type TaskStepUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepUncheckedUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskStepUncheckedUpdateManyWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    idx?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    input?: NullableStringFieldUpdateOperationsInput | string | null
    output?: NullableStringFieldUpdateOperationsInput | string | null
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskTraceUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskTraceUncheckedUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskTraceUncheckedUpdateManyWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    stepId?: NullableStringFieldUpdateOperationsInput | string | null
    role?: StringFieldUpdateOperationsInput | string
    content?: NullableStringFieldUpdateOperationsInput | string | null
    toolCalls?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskDiffUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskDiffUncheckedUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TaskDiffUncheckedUpdateManyWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    commitSha?: NullableStringFieldUpdateOperationsInput | string | null
    patch?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunUncheckedUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentRunUncheckedUpdateManyWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    branch?: StringFieldUpdateOperationsInput | string
    baseCommit?: StringFieldUpdateOperationsInput | string
    resultStatus?: StringFieldUpdateOperationsInput | string
    validationSummary?: NullableStringFieldUpdateOperationsInput | string | null
    publishedVersion?: NullableStringFieldUpdateOperationsInput | string | null
    promptTokens?: NullableIntFieldUpdateOperationsInput | number | null
    completionTokens?: NullableIntFieldUpdateOperationsInput | number | null
    totalTokens?: NullableIntFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TraceSpanUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type TraceSpanUncheckedUpdateWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type TraceSpanUncheckedUpdateManyWithoutTaskInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    spanId?: StringFieldUpdateOperationsInput | string
    parentId?: NullableStringFieldUpdateOperationsInput | string | null
    name?: StringFieldUpdateOperationsInput | string
    startTime?: DateTimeFieldUpdateOperationsInput | Date | string
    endTime?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    status?: StringFieldUpdateOperationsInput | string
    attributes?: NullableStringFieldUpdateOperationsInput | string | null
    events?: NullableStringFieldUpdateOperationsInput | string | null
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use ProjectCountOutputTypeDefaultArgs instead
     */
    export type ProjectCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProjectCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TaskCountOutputTypeDefaultArgs instead
     */
    export type TaskCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TaskCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProjectDefaultArgs instead
     */
    export type ProjectArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProjectDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TaskDefaultArgs instead
     */
    export type TaskArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TaskDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TaskStepDefaultArgs instead
     */
    export type TaskStepArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TaskStepDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TaskTraceDefaultArgs instead
     */
    export type TaskTraceArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TaskTraceDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TaskDiffDefaultArgs instead
     */
    export type TaskDiffArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TaskDiffDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AgentRunDefaultArgs instead
     */
    export type AgentRunArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AgentRunDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TraceSpanDefaultArgs instead
     */
    export type TraceSpanArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TraceSpanDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProviderConfigDefaultArgs instead
     */
    export type ProviderConfigArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProviderConfigDefaultArgs<ExtArgs>
    /**
     * @deprecated Use SkillArtifactDefaultArgs instead
     */
    export type SkillArtifactArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = SkillArtifactDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PromptVersionDefaultArgs instead
     */
    export type PromptVersionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PromptVersionDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}