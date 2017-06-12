const appStore = require('../../../js/stores/appStoreRenderer')
const ImmutableComponent = require('./immutableComponent')
const React = require('react')
const windowStore = require('../../../js/stores/windowStore')
const debounce = require('../../../js/lib/debounce')
const {isList, isSameHashCode} = require('../../common/state/immutableUtil')

const mergePropsImpl = (stateProps, ownProps) => {
  return Object.assign({}, stateProps, ownProps)
}

const buildPropsImpl = (props, componentType) => {
  const fn = componentType.prototype.mergeProps || mergePropsImpl
  const state = appStore.state.set('currentWindow', windowStore.state)
  return fn(state, props)
}

const checkParam = function (old, next, prop) {
  return isList(next[prop])
    ? !isSameHashCode(next[prop], old[prop])
    : next[prop] !== old[prop]
}

const didPropsChange = function (oldProps, newProps) {
  const propKeys = Array.from(new Set(Object.keys(oldProps).concat(Object.keys(newProps))))
  return propKeys.some((prop) => checkParam(oldProps, newProps, prop))
}

class ReduxComponent extends ImmutableComponent {
  constructor (componentType, props) {
    super(props)
    this.componentType = componentType
    this.state = this.buildProps(this.props)
    this.checkForUpdates = debounce(this.checkForUpdates.bind(this), 25)
    this.dontCheck = true
  }

  checkForUpdates () {
    if (!this.dontCheck) {
      this.setState(this.buildProps(this.props))
    }
  }

  componentDidMount () {
    this.dontCheck = false
    appStore.addChangeListener(this.checkForUpdates)
    windowStore.addChangeListener(this.checkForUpdates)
  }

  componentWillUnmount () {
    this.dontCheck = true
    appStore.removeChangeListener(this.checkForUpdates)
    windowStore.removeChangeListener(this.checkForUpdates)
  }

  componentWillReceiveProps (nextProps) {
    if (didPropsChange(this.props, nextProps)) {
      this.setState(this.buildProps(nextProps))
    }
  }

  shouldComponentUpdate (nextProps, nextState) {
    return didPropsChange(this.props, nextProps) || didPropsChange(this.state, nextState)
  }

  mergeProps (stateProps, ownProps) {
    return mergePropsImpl(stateProps, ownProps)
  }

  buildProps (props = this.props) {
    return buildPropsImpl(props, this.componentType)
  }

  render () {
    return React.createElement(this.componentType, this.state)
  }
}

module.exports.connect = (componentType) => {
  return ReduxComponent.bind(null, componentType)
}
