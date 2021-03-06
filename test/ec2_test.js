const {describe, it, beforeEach} = require('mocha')
const {expect} = require('chai')
const EC2 = require('../lib/ec2')

describe('EC2', function () {
  beforeEach(function () {
    this.ec2Client = {}
  })

  beforeEach(function () {
    this.clock = {now: 0}
  })

  beforeEach(function () {
    const ctx = this
    const ec2ClientFactory = function (config) {
      ctx.ec2Config = config
      return ctx.ec2Client
    }
    this.ec2 = new EC2(ec2ClientFactory, {}, {}, this.clock)
  })

  function ec2ClientSharedExamples() {
    it('creates an EC2 client for the specified region', function () {
      return this.result.then(() => {
        expect(this.ec2Config).to.include({region: 'eu-north-9'})
      })
    })
  }

  describe('#loadReservations', function () {
    beforeEach(function () {
      this.reservedInstances = [
        {ReservedInstancesId: 'r1', InstanceType: 'm9.37xlarge', OfferingClass: 'convertible', InstanceCount: 9, Scope: 'Region'},
        {ReservedInstancesId: 'r2', InstanceType: 'p13.medium', OfferingClass: 'standard', InstanceCount: 13, Scope: 'Region'},
        {ReservedInstancesId: 'r3', InstanceType: 'i7.nano', OfferingClass: 'standard', InstanceCount: 3, Scope: 'Availability Zone', AvailabilityZone: 'eu-north-9d'},
      ]
    })

    beforeEach(function () {
      this.calls = 0
      this.ec2Client.describeReservedInstances = (params) => {
        this.calls++
        this.filters = params.Filters
        return {promise: () => Promise.resolve({ReservedInstances: this.reservedInstances})}
      }
    })

    beforeEach(function () {
      this.result = this.ec2.loadReservations('eu-north-9')
    })

    ec2ClientSharedExamples()

    it('requests all active reservations', function () {
      return this.result.then(() => {
        expect(this.filters).to.deep.equal([{Name: 'state', Values: ['active']}])
      })
    })

    it('returns a promise of a list of the reservations returned by EC2', function () {
      return this.result.then((reservations) => {
        expect(reservations.length).to.equal(3)
      })
    })

    it('extracts the reservation ID', function () {
      return this.result.then((reservations) => {
        expect(reservations[0].id).to.equal('r1')
        expect(reservations[1].id).to.equal('r2')
      })
    })

    it('extracts the family and size from the reservations', function () {
      return this.result.then((reservations) => {
        expect(reservations[0].family).to.equal('m9')
        expect(reservations[0].size).to.equal('37xlarge')
        expect(reservations[2].family).to.equal('i7')
        expect(reservations[2].size).to.equal('nano')
      })
    })

    it('extracts the number of instances in the reservation', function () {
      return this.result.then((reservations) => {
        expect(reservations[0].count).to.equal(9)
        expect(reservations[2].count).to.equal(3)
      })
    })

    it('calculates the normalized number of units', function () {
      return this.result.then((reservations) => {
        expect(reservations[0].units).to.equal(9 * (32 * 8 + 5 * 8))
        expect(reservations[2].units).to.equal(3 * 0.25)
      })
    })

    it('extracts the offering class', function () {
      return this.result.then((reservations) => {
        expect(reservations[0].offeringClass).to.equal('convertible')
        expect(reservations[2].offeringClass).to.equal('standard')
      })
    })

    it('sets the AZ to "*" for convertible reservations', function () {
      return this.result.then((reservations) => {
        expect(reservations[0].az).to.equal('*')
      })
    })

    it('sets the AZ to "*" for standard reservations with scope "Region"', function () {
      return this.result.then((reservations) => {
        expect(reservations[1].az).to.equal('*')
      })
    })

    it('sets the AZ to the AZ of the reservation when the scope is "Availability Zone"', function () {
      return this.result.then((reservations) => {
        expect(reservations[2].az).to.equal('eu-north-9d')
      })
    })

    it('caches the result per region', function () {
      return Promise.all([
        this.ec2.loadReservations('eu-north-9'),
        this.ec2.loadReservations('eu-north-7'),
        this.ec2.loadReservations('eu-north-9'),
      ]).then(() => {
        expect(this.calls).to.equal(2)
      })
    })

    it('caches the result for an hour', function () {
      return Promise.all([
        this.ec2.loadReservations('eu-north-9'),
        this.ec2.loadReservations('eu-north-9'),
        this.ec2.loadReservations('eu-north-9'),
      ]).then(() => {
        this.clock.now += 3600000/2
      }).then(() => {
        return this.ec2.loadReservations('eu-north-9')
      }).then(() => {
        this.clock.now += 3600000/2
      }).then(() => {
        return this.ec2.loadReservations('eu-north-9')
      }).then(() => {
        expect(this.calls).to.equal(2)
      })
    })
  })

  describe('#loadInstances', function () {
    beforeEach(function () {
      this.instances = [
        {InstanceType: 'm9.37xlarge', Placement: {AvailabilityZone: 'eu-north-9b'}, Tags: []},
        {InstanceType: 'p13.medium', Placement: {AvailabilityZone: 'eu-north-9d'}, Tags: [{Key: 'Environment', Value: 'test'}]},
        {InstanceType: 'x3.micro', Placement: {AvailabilityZone: 'eu-north-9d'}, InstanceLifecycle: 'spot', Tags: []},
        {InstanceType: 'c17.large', Placement: {AvailabilityZone: 'eu-north-9d'}, Tags: [{Key: 'aws:elasticmapreduce:job-flow-id', Value: '1'}]},
        {InstanceType: 'i7.nano', Placement: {AvailabilityZone: 'eu-north-9g'}, Tags: []},
      ]
    })

    beforeEach(function () {
      this.calls = 0
      this.ec2Client.describeInstances = (params) => {
        this.calls++
        this.filters = params.Filters
        return {promise: () => Promise.resolve({Reservations: [
          {Instances: [this.instances[0], this.instances[1]]},
          {Instances: [this.instances[2]]},
          {Instances: [this.instances[3], this.instances[4]]},
        ]})}
      }
    })

    beforeEach(function () {
      this.result = this.ec2.loadInstances('eu-north-9')
    })

    ec2ClientSharedExamples()

    it('requests all running instances', function () {
      return this.result.then(() => {
        expect(this.filters).to.deep.equal([{Name: 'instance-state-name', Values: ['running']}])
      })
    })

    it('returns a promise of a list of the instances returned by EC2', function () {
      return this.result.then((instances) => {
        expect(instances.length).to.equal(5)
      })
    })

    it('marks spot instances', function () {
      return this.result.then((instances) => {
        expect(instances.map(i => i.spot)).to.deep.equal([false, false, true, false, false])
      })
    })

    it('marks instance used for EMR', function () {
      return this.result.then((instances) => {
        expect(instances.map(i => i.emr)).to.deep.equal([false, false, false, true, false])
      })
    })

    it('extracts the family and size from the instances', function () {
      return this.result.then((instances) => {
        expect(instances[0].family).to.equal('m9')
        expect(instances[0].size).to.equal('37xlarge')
        expect(instances[4].family).to.equal('i7')
        expect(instances[4].size).to.equal('nano')
      })
    })

    it('extracts the AZ from the instances', function () {
      return this.result.then((instances) => {
        expect(instances[0].az).to.equal('eu-north-9b')
        expect(instances[4].az).to.equal('eu-north-9g')
      })
    })

    it('calculates the normalized number of units', function () {
      return this.result.then((instance) => {
        expect(instance[0].units).to.equal(32 * 8 + 5 * 8)
        expect(instance[4].units).to.equal(0.25)
      })
    })

    it('caches the result per region', function () {
      return Promise.all([
        this.ec2.loadInstances('eu-north-9'),
        this.ec2.loadInstances('eu-north-7'),
        this.ec2.loadInstances('eu-north-9'),
      ]).then(() => {
        expect(this.calls).to.equal(2)
      })
    })

    it('caches the result for five minutes', function () {
      return Promise.all([
        this.ec2.loadInstances('eu-north-9'),
        this.ec2.loadInstances('eu-north-9'),
        this.ec2.loadInstances('eu-north-9'),
      ]).then(() => {
        this.clock.now += 300000/2
      }).then(() => {
        return this.ec2.loadInstances('eu-north-9')
      }).then(() => {
        this.clock.now += 300000/2
      }).then(() => {
        return this.ec2.loadInstances('eu-north-9')
      }).then(() => {
        expect(this.calls).to.equal(2)
      })
    })
  })
})
