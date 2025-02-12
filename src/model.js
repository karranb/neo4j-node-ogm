import { Cypher } from './cypher'
import { Collection } from './collection'
import { createGetterAndSetter, convertID } from './utils'
import { hydrate, checkWith } from './hydrate'

const ORDER_BY_FUNCTIONS_ALLOWED = [
  'toUpper',
  'toLower',
  'left',
  'lTrim',
  'replace',
  'right',
  'rTrim',
  'trim',
  'substring',
  'toString',
]

class Model {
  /**
   * Constructor
   *
   * @param {Object} values
   */
  constructor(values = {}, labels = [], attributes = {}) {
    this._with = []
    this._values = values
    this._labels = labels
    this._attributes = attributes
    this._alias = null
    this.filter_attributes = []
    this.errors = {}
    Object.entries(attributes).forEach(([key, field]) => {
      createGetterAndSetter(this, key, field.set, field.get)
    })
    Object.entries(values).forEach(([key, value]) => {
      this[key] = value
    })
  }

  /**
   * Start the retrieve Info based on actual Node
   */
  toJSON() {
    return this.retriveInfo(this)
  }

  /**
   * Retrieve Info from Node as a JSON, only with clean data
   *
   * @param {Object} model
   */
  retriveInfo(model, previous) {
    const data = {}
    data.id = model.id

    //attributes of relations
    if (previous) {
      for (const [relKey] of Object.entries(previous.attributes)) {
        if (model._values[relKey]) data[relKey] = model._values[relKey]
      }
    }

    Object.entries(model._attributes).forEach(([key, field]) => {
      switch (field.type) {
        case 'hash':
          break
        case 'relationship':
          if (model._values[key]) data[key] = this.retriveInfo(model._values[key], field)
          break
        case 'relationships':
          if (model._values[key]) {
            data[key] = Object.values(model._values[key]).map((item) => this.retriveInfo(item, field))
          }
          break
        default:
          data[key] = model[key]
      }
    })

    return data
  }

  getAliasName() {
    return this._alias ?? this._labels.join('').toLowerCase()
  }

  getNodeName() {
    return this._labels.join(':')
  }

  getCypherName(aliasName = false) {
    if (aliasName) {
      return aliasName + ':' + this.getNodeName()
    }

    return this.getAliasName() + ':' + this.getNodeName()
  }

  getAttributes() {
    return Object.entries(this._attributes)
  }

  writeFilter(forNode, relationAlias = undefined) {
    // FILTERS WITH LOCATION
    this.filter_attributes
      .filter((item) => item.for === forNode || item.for === relationAlias || item.$and || item.$or)
      .forEach(({ attr, operator, value, $and, $or }) => {
        this.cypher.addWhere({ attr, operator, value, $and, $or })
      })
    this.cypher.matchs.push(this.cypher.writeWhere())
  }

  writeOrderBy() {
    // FILTERS WITH LOCATION
    this.order_by.forEach(({ attr, direction }) => {
      this.cypher.addOrderBy(attr, direction)
    })
  }

  doMatchs(node, relation, level = 0) {
    if (relation) {
      this.cypher.match(relation.previousNode, relation.previousAlias, relation.relationship, node)
      this.cypher.modelReturn(relation.previousAlias, node)
    } else {
      this.cypher.match(node)
      this.cypher.modelReturn(node.getAliasName(), node)
    }

    this.writeFilter(node.getAliasName(), `${relation?.previousNode?.getAliasName()}_${relation?.previousAlias}`)

    Object.keys(node._attributes).forEach((key) => {
      const field = node._attributes[key]
      if (field.isModel) {
        const [found_condition, isOptional] = checkWith(level, key, this._with)
        if (found_condition) {
          const newNode = new field.target(undefined, node._state)
          this.cypher.modelReturnRelation(`${node.getAliasName()}_${key}`, field)
          newNode.filter_relationship = field.filter_relationship
          newNode._alias = key
          newNode.isOptional = isOptional
          newNode.collectFirst = !field.isArray
          this.doMatchs(
            newNode,
            {
              relationship: `:${field.labels.join(':')}`,
              previousNode: node,
              previousAlias: key,
            },
            level + 1
          )
        }
      }
    })

    return true
  }

  addMatchs(node, field) {
    this.cypher.match(node, false, false, false, field.attr)
    this.cypher.modelReturn(field.attr, node)
    this.cypher.modelReturnRelation(field.relationName, field)
    this.writeFilter(field.attr, `${node.getAliasName()}_${field.attr}`)
  }

  async fetch(with_related = [], state = undefined) {
    // reset alias to default
    this._alias = this._labels.join('').toLowerCase()
    // return a hydrated findAll
    return this.constructor.findAll({
      filter_attributes: [{ key: `id(${this.getAliasName()})`, value: this.id }],
      with_related,
      state,
      parent: this,
    })
  }

  delete(detach = false) {
    this.cypher = new Cypher()
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
    ].map((fa) => this.prepareFilter(fa, this))
    this.doMatchs(this, false)

    return this.cypher.delete(this.getAliasName(), detach)
  }

  setAttributes(create = true) {
    this.errors = {}
    Object.entries(this._attributes).forEach(([key, field]) => {
      this._values[key] = field.getDefaultValue(this._values[key])
      try {
        field.checkValidation(key, this._values[key])
        if (field.isModel === false) {
          this.cypher.addSet(this.getAliasName() + '.' + key, this._values[key])
        } else if (create) {
          // TODO: add the relation
        }
      } catch (e) {
        const error = JSON.parse(e.message)
        this.errors[error.key] = error.msg
      }
    })

    if (Object.keys(this.errors).length > 0) throw new Error('Model invalid, check the .errors attribute')
  }

  isValid() {
    let ret = true
    this.errors = {}

    Object.entries(this._attributes).forEach(([key, field]) => {
      try {
        field.checkValidation(key, field.getDefaultValue(this._values[key]))
      } catch (e) {
        const error = JSON.parse(e.message)
        this.errors[error.key] = error.msg
        ret = false
      }
    })

    return ret
  }

  save() {
    this.cypher = new Cypher()
    if (this.id === undefined) {
      // create
      this.doMatchs(this, false)
      try {
      this.setAttributes(false)
      } catch (err) {
        return Promise.reject(err)
      }
      const recordPromise = this.cypher.create(this.getCypherName())
      return new ModelPromise(recordPromise, (acc) =>
        recordPromise.then(record => acc(hydrate(this, record, this._with)))
      )
    } else {
      // update
      this.cypher.addWhere({
        attr: `id(${this.getAliasName()})`,
        value: this.id,
      })
      this.cypher.isDistinct()
      this.doMatchs(this, false)

      this.setAttributes()

      const recordPromise = this.cypher.update()
      return new ModelPromise(recordPromise, (acc) =>
        recordPromise.then(records => acc(hydrate(this, records[0], this._with)))
      )
    }
  }

  /**
   * Relate nodes
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async relate(attr, node, attributes = {}, create = true) {
    // ADD TO _WITH TO RETURN THE RELATION
    this._with = []
    this.cypher = new Cypher()
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
      {
        key: `id(${attr})`,
        value: node.id,
      },
    ].map((fa) => this.prepareFilter(fa, this))
    this.doMatchs(this)

    // CREATE THE RELATION FOR THIS ATTR
    const field = this._attributes[attr]
    if (!field) throw new Error(`Attribute "${attr}" does not exists on model "${this.getAliasName()}"`)
    field.attr = attr
    field.relationName = `${this.getAliasName()}_${attr}`

    this.addMatchs(node, field)
    // ADD TO _WITH TO RETURN THE RELATION
    this._with = [[attr]]

    // ADD THE ATTRIBUTES ON RELATION
    if (field.attributes) {
      this.errors = {}
      for (const [relKey, relField] of Object.entries(field.attributes)) {
        const value = relField.getDefaultValue(attributes[relKey])
        try {
          relField.checkValidation(relKey, value)
        } catch (e) {
          const error = JSON.parse(e.message)
          this.errors[error.key] = error.msg
        }
        if (value !== undefined)
          this.cypher.addSet(this.getAliasName() + '_' + attr + '.' + relKey, relField.set(value))
      }
    }

    if (Object.keys(this.errors).length > 0) throw new Error('Relationship invalid, check the .errors attribute')

    const data = await this.cypher.relate(this, field, node, create)
    data.forEach((record) => {
      hydrate(this, record, this._with)
    })
  }

  /**
   * Update a relation between the nodes
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async updateRelationship(attr, node, attributes = {}) {
    return this.relate(attr, node, attributes, false)
  }

  /**
   * Create a relation between the nodes
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async createRelationship(attr, node, attributes = {}) {
    return this.relate(attr, node, attributes, true)
  }

  /**
   * Remove the relations about that attribute
   *
   * @param {String} attr
   */
  async removeAllRelationships(attr) {
    this.cypher = new Cypher()
    this._with = [[attr]]
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
    ].map((fa) => this.prepareFilter(fa, this))
    this.doMatchs(this)
    return this.cypher.delete(`${this.getAliasName()}_${attr}`)
  }

  /**
   * Remove the one single relationship based on other node
   *
   * @param {String} attr
   */
  async removeRelationship(attr, node) {
    this.cypher = new Cypher()
    this._with = [[attr]]
    this.filter_attributes = [
      {
        key: `id(${this.getAliasName()})`,
        value: this.id,
      },
      {
        key: `id(${attr})`,
        value: node.id,
      },
    ].map((fa) => this.prepareFilter(fa, this))

    this.doMatchs(this)

    return this.cypher.delete(`${this.getAliasName()}_${attr}`)
  }

  /**
   * Create a new relation and remove the older
   *
   * @param {String} attr
   * @param {Model} node
   * @param {JSON} attributes
   */
  async recreateRelationship(attr, node, attributes = {}) {
    try {
      await this.removeAllRelationships(attr)
    } catch (e) {
      // nothing
    }

    try {
      const data = await this.relate(attr, node, attributes, true)
      return data
    } catch (e) {
      throw new Error('new relation is not possible')
    }
  }

  static findByID(id, config = {}) {
    const self = new this()

    config.filter_attributes = [
      {
        key: `id(${self.getAliasName()})`,
        value: parseInt(id, 10),
      },
    ].concat(config.filter_attributes)

    const sessionPromise = this.findAll(config)
    return new ModelPromise(sessionPromise, (acc) => sessionPromise.then(data => acc(data.first())))
  }

  static findBy(filter_attributes = [], config = {}) {
    config.filter_attributes = filter_attributes
    return this.findAll(config)
  }

  static async count(config = {}) {
    let self
    if (!config.parent) {
      self = new this(undefined, config.state)
      self._state = config.state
    } else {
      self = config.parent
      self.parent = true
    }

    Object.keys(config).forEach((key) => {
      config[key] === undefined && delete config[key]
    })
    config = Object.assign(
      {
        with_related: [],
        filter_attributes: [],
        onlyRelation: false,
        order_by: [],
        skip: '',
        limit: '',
        count: '*',
        optional: true,
        state: undefined,
      },
      config,
    )

    config.with_related.forEach((item) => {
      const w = item.split('__')
      self._with.push(w)
    })
    self.cypher = new Cypher()
    self.cypher.count = config.count

    self.filter_attributes = config.filter_attributes.map((fa) => self.prepareFilter(fa, self))
    self.doMatchs(self, false, 0)
    const data = await self.cypher.find()
    return convertID(data[0]._fields[0])
  }

  static findAll(config = {}) {
    let self
    if (!config.parent) {
      self = new this(undefined, config.state)
      self._state = config.state
    } else {
      self = config.parent
      self.parent = true
    }

    Object.keys(config).forEach((key) => {
      config[key] === undefined && delete config[key]
    })
    config = Object.assign(
      {
        with_related: [],
        filter_attributes: [],
        onlyRelation: false,
        order_by: [],
        skip: '',
        limit: '',
        optional: true,
        state: undefined,
      },
      config
    )

    config.with_related.forEach((item) => {
      const w = item.split('__')
      self._with.push(w)
    })
    // setWith(self._with)

    self.cypher = new Cypher()
    // self.cypher.isDistinct()
    self.cypher.optional = config.optional
    self.cypher.skip = config.skip
    self.cypher.limit = config.limit
    self.filter_attributes = config.filter_attributes.map((fa) => self.prepareFilter(fa, self))

    self.order_by = config.order_by.map((ob) => {
      const isCypherFunction = /.+\(.+\)/.test(ob.key)
      if (isCypherFunction) {
        const regExp = /(.+)\(([^)]+)\)/
        const matches = regExp.exec(ob.key)

        if (!ORDER_BY_FUNCTIONS_ALLOWED.includes(matches[1]))
          throw new Error(`Function (${matches[1]}) are not allowed in order_by`)

        ob.for = matches[2]
        ob.attr = ob.key
      } else {
        ob.for = ob.key.split('.').length > 1 ? ob.key.split('.')[0] : self.getAliasName()
        ob.attr = ob.key.split('.').length > 1 ? ob.key : `${self.getAliasName()}.${ob.key}`
      }

      return ob
    })
    self.doMatchs(self, false, 0)
    self.writeOrderBy()

    const dataPromise = self.cypher.find()
    return new ModelPromise(dataPromise, (resolve) =>
      dataPromise.then((data) => {
        const result = new Collection()
        const ids = []
        data.forEach((record) => {
          let model = new this(undefined, config.state)
          model._state = config.state
          const main = record._fields[record._fieldLookup[model.getAliasName()]]
          const id = convertID(main.id)

          if (config.parent) {
            model = config.parent
          } else {
            if (ids.includes(id)) {
              model = result[ids.indexOf(id)]
            } else {
              ids.push(id)
            }
          }

          result[ids.indexOf(id)] = hydrate(model, record, self._with)
        })
        resolve(result)
    }))
  }

  prepareFilter(fa, model) {
    if (!fa) return false
    if (fa.$and) {
      fa.$and = fa.$and.map(filter => this.prepareFilter(filter, model))
      return fa
    }
    if (fa.$or) {
      fa.$or = fa.$or.map(filter => this.prepareFilter(filter, model))
      return fa
    }
    const isCypherFunction = /.+\(.+\)/.test(fa.key)
    if (isCypherFunction) {
      const regExp = /\(([^)]+)\)/
      const matches = regExp.exec(fa.key)

      //matches[1] contains the value between the parentheses
      fa.for = matches[1]
      fa.attr = fa.key
    } else {
      fa.for = fa.key.split('.').length > 1 ? fa.key.split('.')[0] : model.getAliasName()
      fa.attr = fa.key.split('.').length > 1 ? fa.key : `${model.getAliasName()}.${fa.key}`
    }
    return fa
  }
}

class ModelPromise  {
  constructor(session, executor) {
    this.executor = executor
    this.session = session
  }

  toString() {
    return this.session.toString()
  }

  then(...args) {
    return new Promise(this.executor).then(...args)
  }

  catch(...args) {
    return new Promise(this.executor).catch(...args)
  }
}

export { Model }
