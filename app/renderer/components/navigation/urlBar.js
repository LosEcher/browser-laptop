/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const React = require('react')
const {StyleSheet, css} = require('aphrodite')
const Immutable = require('immutable')
const ipc = require('electron').ipcRenderer

// Components
const ReduxComponent = require('../reduxComponent')
const UrlBarSuggestions = require('./urlBarSuggestions')
const UrlBarIcon = require('./urlBarIcon')

// Actions
const windowActions = require('../../../../js/actions/windowActions')
const appActions = require('../../../../js/actions/appActions')

// Constants
const messages = require('../../../../js/constants/messages')
const settings = require('../../../../js/constants/settings')
const KeyCodes = require('../../../common/constants/keyCodes')

// State
const frameStateUtil = require('../../../../js/state/frameStateUtil')
const siteSettings = require('../../../../js/state/siteSettings')
const tabState = require('../../../common/state/tabState')
const siteSettingsState = require('../../../common/state/siteSettingsState')
const menuBarState = require('../../../common/state/menuBarState')

// Utils
const cx = require('../../../../js/lib/classSet')
const debounce = require('../../../../js/lib/debounce')
const {getSetting} = require('../../../../js/settings')
const contextMenus = require('../../../../js/contextMenus')
const UrlUtil = require('../../../../js/lib/urlutil')
const {eventElHasAncestorWithClasses, isForSecondaryAction} = require('../../../../js/lib/eventUtil')
const {getBaseUrl, isUrl} = require('../../../../js/lib/appUrlUtil')
const {getCurrentWindowId} = require('../../currentWindow')
const {normalizeLocation} = require('../../../common/lib/suggestion')

// Icons
const iconNoScript = require('../../../../img/url-bar-no-script.svg')

class UrlBar extends React.Component {
  constructor (props) {
    super(props)
    this.lastVal = ''
    this.lastSuffix = ''
    this.onFocus = this.onFocus.bind(this)
    this.onBlur = this.onBlur.bind(this)
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)
    this.onChange = this.onChange.bind(this)
    this.onKeyPress = this.onKeyPress.bind(this)
    this.onClick = this.onClick.bind(this)
    this.onContextMenu = this.onContextMenu.bind(this)
    this.showAutocompleteResult = debounce(() => {
      if (!this.urlInput) {
        return
      }
      this.updateAutocomplete(this.lastVal)
    }, 10)
  }

  maybeUrlBarTextChanged (value) {
    if (value !== this.props.urlbarLocation) {
      appActions.urlBarTextChanged(getCurrentWindowId(), this.props.activeTabId, value)
    }
  }

  // restores the url bar to the current location
  restore () {
    this.setValue(this.props.displayURL)
  }

  /**
   * Build a search URL considering:
   * - user's default search engine provider
   * - search engine shortcut keywords
   *
   * Future considerations could include criteria such as:
   * - user's country / locale (amazon.com vs amazon.ca)
   * - http verb
   */
  buildSearchUrl (searchTerms) {
    searchTerms = searchTerms.replace(this.props.searchShortcut, '')
    return this.props.searchURL.replace('{searchTerms}', encodeURIComponent(searchTerms))
  }

  // Temporarily disable the autocomplete when a user is pressing backspace.
  // Otherwise, they'd have to hit backspace twice for each character they wanted
  // to delete.
  hideAutoComplete () {
    this.lastSuffix = ''
    if (this.props.autocompleteEnabled) {
      windowActions.urlBarAutocompleteEnabled(false)
    }
    windowActions.setRenderUrlBarSuggestions(false)
  }

  get activeIndex () {
    if (this.props.suggestionList === null) {
      return -1
    }
    return this.props.selectedIndex
  }

  onKeyDown (e) {
    if (!this.props.isActive) {
      windowActions.setUrlBarActive(true)
    }
    switch (e.keyCode) {
      case KeyCodes.SHIFT:
        break
      case KeyCodes.ENTER:
        e.preventDefault()
        let location = this.urlInput ? this.getValue() : this.props.urlbarLocation

        if (location === null || location.length === 0) {
          windowActions.setUrlBarSelected(true)
        } else {
          // Filter javascript URLs to prevent self-XSS
          location = location.replace(/^(\s*javascript:)+/i, '')
          const isLocationUrl = isUrl(location)
          if (!isLocationUrl && e.ctrlKey) {
            appActions.loadURLRequested(this.props.activeTabId, `www.${location}.com`)
          } else if (this.shouldRenderUrlBarSuggestions &&
              ((typeof this.activeIndex === 'number' && this.activeIndex >= 0) ||
              (this.props.urlbarLocationSuffix && this.props.autocompleteEnabled))) {
            // Hack to make alt enter open a new tab for url bar suggestions when hitting enter on them.
            const isDarwin = process.platform === 'darwin'
            if (e.altKey) {
              if (isDarwin) {
                e.metaKey = true
              } else {
                e.ctrlKey = true
              }
            }
            windowActions.activeSuggestionClicked(isForSecondaryAction(e), e.shiftKey)
          } else {
            location = isLocationUrl
              ? location
              : this.buildSearchUrl(location)
            // do search.
            if (e.altKey) {
              appActions.createTabRequested({
                url: location
              })
            } else if (e.metaKey) {
              appActions.createTabRequested({
                url: location,
                active: !!e.shiftKey
              })
            } else {
              appActions.loadURLRequested(this.props.activeTabId, location)
            }
          }
        }
        windowActions.setUrlBarActive(false)
        windowActions.setRenderUrlBarSuggestions(false)
        break
      case KeyCodes.UP:
        if (this.shouldRenderUrlBarSuggestions) {
          windowActions.previousUrlBarSuggestionSelected()
          e.preventDefault()
        }
        break
      case KeyCodes.DOWN:
        if (this.shouldRenderUrlBarSuggestions) {
          windowActions.nextUrlBarSuggestionSelected()
          e.preventDefault()
        }
        break
      case KeyCodes.ESC:
        e.preventDefault()
        this.props.onStop()
        this.restore()
        this.select()
        break
      case KeyCodes.DELETE:
        if (e.shiftKey) {
          const selectedIndex = this.props.urlbarLocationSuffix.length > 0 ? 1 : this.props.selectedIndex
          if (selectedIndex !== undefined) {
            const suggestionLocation = this.props.suggestion.location
            appActions.removeSite({ location: suggestionLocation })
          }
        } else {
          this.hideAutoComplete()
        }
        break
      case KeyCodes.BACKSPACE:
        this.hideAutoComplete()
        break
      case KeyCodes.TAB:
        if (this.shouldRenderUrlBarSuggestions) {
          if (e.shiftKey) {
            windowActions.previousUrlBarSuggestionSelected()
          } else {
            windowActions.nextUrlBarSuggestionSelected()
          }
          e.preventDefault()
        }
        break
      default:
        // Only enable suggestions and autocomplete if we are typing in
        // a printable character without cmd/ctrl
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          windowActions.setRenderUrlBarSuggestions(true)
          // Any other keydown is fair game for autocomplete to be enabled.
          if (!this.props.autocompleteEnabled) {
            windowActions.urlBarAutocompleteEnabled(true)
          }
        }
    }
  }

  onClick (e) {
    if (this.props.isSelected) {
      windowActions.setUrlBarActive(true)
    }
  }

  onBlur (e) {
    windowActions.urlBarOnBlur(getCurrentWindowId(), e.target.value, this.props.urlbarLocation, eventElHasAncestorWithClasses(e, ['urlBarSuggestions', 'urlbarForm']))
  }

  get suggestionLocation () {
    const selectedIndex = this.props.selectedIndex
    if (typeof selectedIndex === 'number') {
      const suggestion = this.props.suggestion
      if (suggestion) {
        return suggestion.location
      }
    }
  }

  updateAutocomplete (newValue) {
    let suggestion = ''
    let suggestionNormalized = ''
    if (this.props.suggestionList && this.props.suggestionList.size > 0) {
      suggestion = this.props.suggestionList.getIn([this.activeIndex || 0, 'location']) || ''
      suggestionNormalized = normalizeLocation(suggestion)
    }
    const newValueNormalized = normalizeLocation(newValue)
    if (suggestionNormalized.startsWith(newValueNormalized) && suggestionNormalized.length > 0) {
      const newSuffix = suggestionNormalized.substring(newValueNormalized.length)
      this.setValue(newValue, newSuffix)
      this.urlInput.setSelectionRange(newValue.length, newValue.length + newSuffix.length + 1)
      return true
    } else {
      this.setValue(newValue, '')
      return false
    }
  }

  onKeyPress (e) {
    // handle urlInput.value = '' from tests
    if (this.urlInput.value === '') {
      this.lastVal = ''
      this.lastSuffix = ''
    }

    // if there is no selection then we are not in autocomplete
    // so make sure that this.lastValue is set to urlInput.value
    if (this.urlInput.selectionStart === this.urlInput.selectionEnd) {
      this.lastVal = this.urlInput.value
      this.lastSuffix = ''
    }

    const selectionStart = this.urlInput.selectionStart
    const newValue = [
      this.lastVal.slice(0, selectionStart),
      String.fromCharCode(e.which),
      this.lastVal.slice(this.urlInput.selectionEnd)
    ].join('')

    if (!this.updateAutocomplete(newValue)) {
      this.setValue(newValue)
      this.urlInput.setSelectionRange(selectionStart + 1, selectionStart + 1)
    }

    e.preventDefault()
  }

  onChange (e) {
    if (e.target.value !== this.lastVal + this.lastSuffix) {
      e.preventDefault()
      this.setValue(e.target.value)
    }
  }

  getValue () {
    return this.lastVal + this.lastSuffix
  }

  // Keeps track of which part was set for the url suffix and which
  // part was set for the value.
  setValue (val, suffix) {
    val = val || ''
    suffix = suffix || ''
    this.lastVal = val
    this.lastSuffix = suffix
    const newValue = val + suffix
    if (this.urlInput && this.urlInput.value !== newValue) {
      this.urlInput.value = newValue
    }
    this.maybeUrlBarTextChanged(val)
  }

  onKeyUp (e) {
    switch (e.keyCode) {
      case KeyCodes.UP:
      case KeyCodes.DOWN:
      case KeyCodes.TAB:
      case KeyCodes.ESC:
      case KeyCodes.LEFT:
      case KeyCodes.SHIFT:
      case KeyCodes.RIGHT:
        return
    }
    if (this.props.isSelected) {
      windowActions.setUrlBarSelected(false)
    }
    this.maybeUrlBarTextChanged(this.lastVal)
  }

  select () {
    setImmediate(() => {
      if (this.urlInput) {
        this.urlInput.select()
      }
    })
  }

  focus () {
    setImmediate(() => {
      if (this.urlInput) {
        this.urlInput.focus()
      }
    })
  }

  onFocus (e) {
    this.select()
    windowActions.urlBarOnFocus(getCurrentWindowId())
  }

  componentWillMount () {
    ipc.on(messages.SHORTCUT_FOCUS_URL, (e) => {
      this.focus()
      this.select()
      windowActions.setRenderUrlBarSuggestions(false)
      windowActions.setUrlBarActive(true)
      windowActions.urlBarOnFocus(getCurrentWindowId())
    })
  }

  componentDidMount () {
    this.setValue(this.props.displayURL)
    this.focus()
  }

  componentDidUpdate (prevProps) {
    if (this.props.activeFrameKey !== prevProps.activeFrameKey) {
      // The user just changed tabs
      this.setValue(this.props.urlbarLocation)

      // Each tab has a focused state stored separately
      if (this.props.isFocused) {
        this.focus()
        this.select()
      }
      windowActions.setRenderUrlBarSuggestions(false)
    } else if (this.props.displayURL !== prevProps.displayURL) {
      // This is a url nav change
      // This covers the case of user typing fast on newtab when they have lag from lots of bookmarks.
      if (!(prevProps.frameLocation === 'about:blank' && this.props.frameLocation === 'about:newtab' && this.props.urlbarLocation !== 'about:blank')) {
        this.setValue(this.props.displayURL)
      }
    } else if (this.props.isActive &&
              this.props.urlbarLocationSuffix !== this.lastSuffix) {
      this.showAutocompleteResult()
    } else if ((this.props.titleMode !== prevProps.titleMode) ||
        (!this.props.isActive && !this.props.isFocused)) {
      this.setValue(this.props.urlbarLocation)
    }

    if (this.props.isSelected && !prevProps.isSelected) {
      this.select()
      windowActions.setUrlBarSelected(false)
    }

    if (this.props.noScriptIsVisible && !this.props.showNoScriptInfo) {
      // There are no blocked scripts, so hide the noscript dialog.
      windowActions.setNoScriptVisible(false)
    }
  }

  get titleValue () {
    // For about:newtab we don't want the top of the browser saying New Tab
    // Instead just show "Brave"
    return ['about:blank', 'about:newtab'].includes(this.props.urlbarLocation)
      ? '' : this.props.title
  }

  get loadTime () {
    if (this.props.startLoadTime && this.props.endLoadTime) {
      const loadMilliseconds = this.props.endLoadTime - this.props.startLoadTime
      return (loadMilliseconds / 1000).toFixed(2) + 's'
    }
    return ''
  }

  get shouldRenderUrlBarSuggestions () {
    return this.props.shouldRender === true &&
      this.props.suggestionList && this.props.suggestionList.size > 0
  }

  onNoScript () {
    windowActions.setNoScriptVisible()
  }

  onContextMenu (e) {
    contextMenus.onUrlBarContextMenu(e)
  }

  mergeProps (state, ownProps) {
    const currentWindow = state.get('currentWindow')
    const activeFrame = frameStateUtil.getActiveFrame(currentWindow) || Immutable.Map()
    const activeTabId = activeFrame.get('tabId') || tabState.TAB_ID_NONE

    const location = tabState.getVisibleURL(state, activeTabId)
    const frameLocation = activeFrame.get('location') || ''
    const displayEntry = tabState.getVisibleEntry(state, activeTabId) || Immutable.Map()
    const displayURL = tabState.getVisibleVirtualURL(state, activeTabId) || ''
    const hostValue = displayEntry.get('host', '')
    const protocol = displayEntry.get('protocol', '')

    const baseUrl = getBaseUrl(location)
    const urlbar = activeFrame.getIn(['navbar', 'urlbar']) || Immutable.Map()
    const urlbarLocation = urlbar.get('location')
    const selectedIndex = urlbar.getIn(['suggestions', 'selectedIndex'])
    const allSiteSettings = siteSettingsState.getAllSiteSettings(state, activeFrame.get('isPrivate'))
    const braverySettings = siteSettings.getSiteSettingsForURL(allSiteSettings, location)

    // TODO(bridiver) - these definitely needs a helpers
    const publisherId = state.getIn(['locationInfo', baseUrl, 'publisher'])
    const hostPattern = UrlUtil.getHostPattern(publisherId)
    const hostSettings = siteSettings.getSiteSettingsForHostPattern(state.get('settings'), hostPattern)
    const ledgerPaymentsShown = hostSettings && hostSettings.get('ledgerPaymentsShown')
    const visiblePublisher = typeof ledgerPaymentsShown === 'boolean' ? ledgerPaymentsShown : true
    const isPublisherButtonEnabled = getSetting(settings.PAYMENTS_ENABLED) &&
        UrlUtil.isHttpOrHttps(location) && visiblePublisher

    const activateSearchEngine = urlbar.getIn(['searchDetail', 'activateSearchEngine'])
    const urlbarSearchDetail = urlbar.get('searchDetail')
    let searchURL = state.getIn(['searchDetail', 'searchURL'])
    let searchShortcut = ''
    // remove shortcut from the search terms
    if (activateSearchEngine && urlbarSearchDetail !== null) {
      const provider = urlbarSearchDetail
      searchShortcut = new RegExp('^' + provider.get('shortcut') + ' ', 'g')
      searchURL = provider.get('search')
    }

    const isHTTPPage = protocol === 'http' || protocol === 'https'

    const props = {}

    props.activeTabId = activeTabId
    props.activeFrameKey = activeFrame.get('key')
    props.frameLocation = frameLocation
    props.displayURL = displayURL
    props.hostValue = hostValue
    props.title = activeFrame.get('title') || ''
    props.scriptsBlocked = activeFrame.getIn(['noScript', 'blocked'])
    props.enableNoScript = siteSettingsState.isNoScriptEnabled(state, braverySettings)
    props.showNoScriptInfo = props.enableNoScript && props.scriptsBlocked && props.scriptsBlocked.size
    props.isSecure = activeFrame.getIn(['security', 'isSecure'])
    props.hasSuggestionMatch = urlbar.getIn(['suggestions', 'hasSuggestionMatch'])
    props.startLoadTime = activeFrame.get('startLoadTime')
    props.endLoadTime = activeFrame.get('endLoadTime')
    props.loading = activeFrame.get('loading')
    props.noScriptIsVisible = currentWindow.getIn(['ui', 'noScriptInfo', 'isVisible']) || false
    props.menubarVisible = ownProps.menubarVisible
    props.activeTabShowingMessageBox = tabState.isShowingMessageBox(state, activeTabId)
    props.noBorderRadius = isPublisherButtonEnabled
    props.onStop = ownProps.onStop
    props.titleMode = ownProps.titleMode
    props.urlbarLocation = urlbarLocation
    props.urlbarLocationSuffix = urlbar.getIn(['suggestions', 'urlSuffix'])
    props.selectedIndex = selectedIndex
    props.suggestionList = urlbar.getIn(['suggestions', 'suggestionList'])
    props.suggestion = urlbar.getIn(['suggestions', 'suggestionList', selectedIndex - 1])
    props.shouldRender = urlbar.getIn(['suggestions', 'shouldRender'])
    props.urlbarLocation = urlbarLocation
    props.isActive = urlbar.get('active')
    props.isSelected = urlbar.get('selected')
    props.isFocused = urlbar.get('focused')
    props.isHTTPPage = isHTTPPage
    props.isWideURLbarEnabled = getSetting(settings.WIDE_URL_BAR)
    props.activateSearchEngine = activateSearchEngine
    props.searchSelectEntry = urlbarSearchDetail
    props.autocompleteEnabled = urlbar.getIn(['suggestions', 'autocompleteEnabled'])
    props.searchURL = searchURL
    props.searchShortcut = searchShortcut
    props.showDisplayTime = !props.titleMode && props.displayURL === location
    props.menubarVisible = menuBarState.isMenuBarVisible(currentWindow)

    return props
  }

  render () {
    return <form
      className={cx({
        urlbarForm: true,
        [css(styles.urlbarForm_wide)]: this.props.isWideURLbarEnabled,
        noBorderRadius: this.props.noBorderRadius
      })}
      action='#'
      id='urlbar'
      ref='urlbar'>
      <div className='urlbarIconContainer'>
        <UrlBarIcon
          activateSearchEngine={this.props.activateSearchEngine}
          active={this.props.isActive}
          isSecure={this.props.isSecure}
          isHTTPPage={this.props.isHTTPPage}
          loading={this.props.loading}
          location={this.props.displayURL}
          searchSelectEntry={this.props.searchSelectEntry}
          title={this.props.title}
          titleMode={this.props.titleMode}
          isSearching={this.props.displayURL !== this.props.urlbarLocation}
          activeTabShowingMessageBox={this.props.activeTabShowingMessageBox}
        />
      </div>
      {
        this.props.titleMode
        ? <div id='titleBar'>
          <span><strong>{this.props.hostValue}</strong></span>
          <span>{this.props.hostValue && this.titleValue ? ' | ' : ''}</span>
          <span>{this.titleValue}</span>
        </div>
        : <input type='text'
          spellCheck='false'
          disabled={this.props.displayURL === undefined && this.loadTime === ''}
          onFocus={this.onFocus}
          onBlur={this.onBlur}
          onKeyDown={this.onKeyDown}
          onKeyUp={this.onKeyUp}
          onChange={this.onChange}
          onKeyPress={this.onKeyPress}
          onClick={this.onClick}
          onContextMenu={this.onContextMenu}
          data-l10n-id='urlbar'
          className={cx({
            private: this.private,
            testHookLoadDone: !this.props.loading
          })}
          id='urlInput'
          readOnly={this.props.titleMode}
          ref={(node) => { this.urlInput = node }} />
      }
      <legend />
      {
        this.props.showDisplayTime
        ? <span className={cx({
          'loadTime': true,
          'onFocus': this.props.isActive
        })}>{this.loadTime}</span>
        : null
      }
      {
        !this.props.showNoScriptInfo
        ? null
        : <span className={css(styles.noScriptContainer)}
          onClick={this.onNoScript}>
          <span
            data-l10n-id='noScriptButton'
            data-test-id='noScriptButton'
            className={css(styles.noScriptButton)} />
        </span>
      }
      {
          this.shouldRenderUrlBarSuggestions
          ? <UrlBarSuggestions
            menubarVisible={this.props.menubarVisible}
          />
          : null
        }
    </form>
  }
}

const styles = StyleSheet.create({
  noScriptContainer: {
    display: 'flex',
    padding: '5px',
    marginRight: '-8px',
    WebkitAppRegion: 'drag'
  },
  noScriptButton: {
    WebkitAppRegion: 'no-drag',
    backgroundImage: `url(${iconNoScript})`,
    width: '14px',
    height: '14px',
    border: '0px'
  },

  urlbarForm_wide: {
    // cf: https://github.com/brave/browser-laptop/blob/b161b37cf5e9f59be64855ebbc5d04816bfc537b/less/navigationBar.less#L682-L684
    maxWidth: '100%'
  }
})

module.exports = ReduxComponent.connect(UrlBar)
