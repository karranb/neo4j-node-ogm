import { expect } from 'chai'
import { User, Role, Text } from './models'

describe('Use Cases - 02', () => {
  describe('::manage user', () => {
    let user
    let user_id
    it('findBy', done => {
      User.findBy([{ key: 'email', value: 'email2@domain.com' }])
        .then(users => {
          user = users.toValues()[0]
          user_id = user.id
          expect(user.email).to.be.equal('email2@domain.com')
        })
        .then(() => done(), done)
    })

    it('update', done => {
      user.email = 'emailupdated@domain.com'
      user
        .save()
        .then(() => {
          expect(user.email).to.be.equal('emailupdated@domain.com')
        })
        .then(() => done(), done)
    })
  })

  describe('::findAll', () => {
    it('get all users', done => {
      User.findAll({
        order_by: [{ key: 'email' }],
      })
        .then(users => {
          expect(users.first().email).to.be.equal('email@domain.com')
        })
        .then(() => done(), done)
    })

    it('get all users filter with special char', done => {
      User.findAll({
        filter_attributes: [
          { key: 'name', value: "'User special char test"}
        ]
      })
        .then(users => {
          expect(users.length()).to.equal(1)
          expect(users.first().email).to.be.equal('emailupdated@domain.com')
        })
        .then(() => done(), done)
    })

    it('get all users filter using IN operator', done => {
      User.findAll({
        filter_attributes: [
          { key: 'email', operator: 'IN', value: ['emailupdated@domain.com'] }
        ]
      })
        .then(users => {
          expect(users.length()).to.equal(1)
          expect(users.first().email).to.be.equal('emailupdated@domain.com')
        })
        .then(() => done(), done)
    })

    it('get all users filter using boolean = false', done => {
      User.findAll({
        filter_attributes: [
          { key: 'active', value: false }
        ]
      })
        .then(users => {
          expect(users.length()).to.equal(1)
          expect(users.first().email).to.be.equal('emailupdated@domain.com')
        })
        .then(() => done(), done)
    })

    it('get all users inverse orderby', done => {
      User.findAll({
        order_by: [{ key: 'email', direction: 'DESC' }],
      })
        .then(users => {
          expect(users.first().email).to.be.equal('emailupdated@domain.com')
        })
        .then(() => done(), done)
    })

    it('get all roles', done => {
      Role.findAll()
        .then(roles => {
          expect(roles.toJSON()).to.have.lengthOf.at.least(1)
        })
        .then(() => done(), done)
    })

    it('get all texts', done => {
      Text.findAll()
        .then(texts => {
          expect(texts.toJSON()).to.have.lengthOf.at.least(1)
        })
        .then(() => done(), done)
    })

    it('get all users with roles, state example', done => {
      User.findAll({ with_related: ['role__name'], state: { language: 'pt-BR' } })
        .then(users => {
          expect(users.toJSON()).to.have.lengthOf.at.least(1)
        })
        .then(() => done(), done)
    })
  })
})
