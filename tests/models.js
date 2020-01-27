import { Model, Field } from '../build'

class Text extends Model {
  constructor (values) {
    const labels = ['Text']
    const attributes = {
      value: Field.String()
    }
    super(values, labels, attributes)
  }
}

class Role extends Model {
  constructor (values) {
    const labels = ['Role']
    const attributes = {
      key: Field.String({
        required: true,
        set: (value) => {
          return value.toUpperCase()
        },
        get: (value) => {
          return `key-${value}`
        }
      }),
      name: Field.Relationship({
        with: true,
        labels: ['TRANSLATE'],
        target: Text,
        filter_relationship: {
          language: 'en_US'
        }
      })
    }
    super(values, labels, attributes)
  }
}

class User extends Model {
  constructor (values) {
    const labels = ['User']
    const attributes = {
      name: Field.String(),
      email: Field.String({
        max_length: 255,
        required: true
      }),
      password: Field.Hash(),
      created_at: Field.DateTime({
        default: () => new Date()
      }),
      role: Field.Relationship({
        labels: ['HAS_ROLE'],
        target: Role
      }), // role : { label: 'HAS_ROLE': children: Node }
      friends: Field.Relationships({
        labels: ['FRIENDSHIP'],
        target: User,
        attributes: {
          intimacy: Field.String()
        }
      }) // friends : { label: 'FRIENDSHIP': children: [Node, ...] }
    }
    super(values, labels, attributes)
  }
}

export { User, Role, Text }
