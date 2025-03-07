# HTTP Cache configuration.
#
# Provides application-specific cache configuration used by all our various
# HTTP cache layers.
#
# Note that this implementation does include some Varnish-specific logic; we no
# longer use Varnish and so no longer rely on that logic. We could consider
# removing our support for Varnish and simplifying this implementation.
#
# `pegasus` and `dashboard` keys each return a Hash in the following format:
#
# - `behaviors`: Array of behaviors. For a given HTTP request, `behaviors` is searched in-order until the first matching `path` is found. If no `path` matches the request, the `default` behavior is used.
#   - `path`: Path string to match this behavior against.  A single `*`-wildcard is required, either an extension-wildcard `/*.jpg` or path-wildcard `/api/*`.
#     - `path` can be a String or an Array. If it is an Array, a separate behavior will be generated for each element.
#     - Paths match the CloudFront [path pattern](http://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html#DownloadDistValuesPathPattern) syntax, with additional restrictions:
#       - `?` and `&` characters are not allowed.
#       - Only a single `*` wildcard is allowed at the start or end of the path pattern.
#   - `headers` (CloudFront-only): Cache objects based on additional HTTP request headers.  To include all headers (which disables caching entirely for the path), pass `['*']`.  To include no additional request headers in the cache key, pass `[]`.
#     - Note: Objects are already cached based on the `Host` header by default.
#     - Note: `headers` is currently only used by CloudFront, while Varnish caches objects based on the `Vary` HTTP response header.
#   - `query`: (boolean) Forward query strings to the origin. (default `true`)
#   - `cookies`: An allowlist array of HTTP cookie keys to pass to the origin and include in the cache key.  To allowlist all cookies for the path, pass `'all'`.  To strip all cookies for the path, pass `'none'`.
#   - `proxy` (Varnish-only): If specified, proxy all requests matching this path to the specified origin. (Currently either `'dashboard'` or `'pegasus'`)
#     - Note: paths are not rewritten, so e.g., a GET request to `server1.code.org/here/abc` configured with the behavior `{path: '/here/*' proxy: 'dashboard' }` will proxy its request to `server1-studio.code.org/here/abc`.
#     - Note: `proxy` is not yet implemented in CloudFront.  (Proxies will still work correctly when passed through to Varnish.)
# - `default`: Default behavior if no other path patterns are matched.  Uses the same syntax as `behaviors` except `path` is not required.
class HttpCache
  # Paths for files that are always cached based on their extension.
  STATIC_ASSET_EXTENSION_PATHS = %w(css js mp3 jpg png).map {|ext| "/*.#{ext}"}.freeze

  # Language header and cookie are needed to separately cache language-specific pages.
  LANGUAGE_HEADER = %w(Accept-Language).freeze
  COUNTRY_HEADER = %w(CloudFront-Viewer-Country).freeze
  ALLOWLISTED_HEADERS = LANGUAGE_HEADER + COUNTRY_HEADER

  DEFAULT_COOKIES = [
    # Language drop-down selection.
    'language_',
    # Offline experiment flag, to allow users into the pilot
    'offline_pilot',
    # Experiment flag used to debug the onetrust cookie experience.
    'onetrust_cookie_scripts',
    # Page mode, for A/B experiments and feature-flag rollouts.
    'pm'
  ].freeze

  # A list of script levels that should not be cached, even though they are
  # in a cacheable script
  UNCACHED_UNIT_LEVEL_PATHS = [
    '/s/dance/lessons/1/levels/13',
    '/s/dance-2019/lessons/1/levels/10',
    '/s/poem-art-2021/lessons/1/levels/9',
    '/s/poem-art-2021/lessons/1/levels/2', # prediction levels are not cacheable
    '/s/poem-art-2021/lessons/1/levels/5', # prediction levels are not cacheable
    '/s/hello-world-food-2021/lessons/1/levels/11',
    '/s/hello-world-animals-2021/lessons/1/levels/11',
    '/s/hello-world-retro-2021/lessons/1/levels/11',
    '/s/hello-world-emoji-2021/lessons/1/levels/11',
    '/s/hello-world-space-2022/lessons/1/levels/11',
    '/s/hello-world-soccer-2022/lessons/1/levels/11',
    '/s/outbreak/lessons/1/levels/10'
  ]

  # A map from script name to script level URL pattern.
  CACHED_UNITS_MAP = %w(
    aquatic
    starwars
    starwarsblocks
    mc
    frozen
    gumball
    minecraft
    hero
    sports
    basketball
    dance
    dance-2019
    oceans
    poem-art-2021
    hello-world-food-2021
    hello-world-animals-2021
    hello-world-retro-2021
    hello-world-emoji-2021
    hello-world-space-2022
    hello-world-soccer-2022
    outbreak
  ).map do |script_name|
    # Most scripts use the default route pattern.
    [script_name, "/s/#{script_name}/lessons/*"]
  end.to_h.merge(
    # Add the "special case" routes here.
    'hourofcode' => '/hoc/*',
    'flappy' => '/flappy/*'
  ).freeze

  def self.cached_scripts
    CACHED_UNITS_MAP.keys
  end

  ALLOWED_WEB_REQUEST_HEADERS = %w(
    Authorization
  )

  # HTTP-cache configuration that can be applied both to CDN (e.g. Cloudfront) and origin-local HTTP cache (e.g. Varnish).
  # Whenever possible, the application should deliver correct HTTP response headers to direct cache behaviors.
  # This hash provides extra application-specific configuration for allowlisting specific request headers and
  # cookies based on the request path.
  def self.config(env)
    env_suffix = env.to_s == 'production' ? '' : "_#{env}"
    session_key = "_learn_session#{env_suffix}"
    storage_id = "storage_id#{env_suffix}"

    # Signed-in user type (student/teacher), or signed-out if cookie is not present.
    user_type = "_user_type#{env_suffix}"
    # Students younger than 13 shouldn't see App Lab and Game Lab unless they
    # are in a teacher's section for privacy reasons.
    limit_project_types = "_limit_project_types#{env_suffix}"
    # Whether admin has assumed current identity
    assumed_identity = "_assumed_identity#{env_suffix}"
    default_cookies = DEFAULT_COOKIES + [user_type, limit_project_types, assumed_identity]

    # These cookies are allowlisted on all session-specific (not cached) pages.
    allowlisted_cookies = [
      'hour_of_code',
      'progress',
      'lines',
      'scripts',
      'videos_seen',
      'callouts_seen',
      'rack.session',
      'remember_user_token',
      '__profilin', # Used by rack-mini-profiler
      session_key,
      storage_id,
    ].concat(default_cookies)

    {
      pegasus: {
        behaviors: [
          {
            # Serve Sprockets-bundled assets directly from the S3 bucket synced via `assets:precompile`.
            #
            path: '/assets/*',
            proxy: 'cdo-assets',
            headers: [],
            cookies: 'none'
          },
          {
            path: '/api/hour/*',
            headers: ALLOWLISTED_HEADERS,
            # Allow the company cookie to be read and set to track company users for tutorials.
            cookies: allowlisted_cookies + ['company']
          },
          # For static-asset paths, don't forward any cookies or additional headers.
          {
            path: STATIC_ASSET_EXTENSION_PATHS + %w(/files/* /images/* /fonts/*),
            headers: [],
            cookies: 'none'
          },
          # Dashboard-based API paths in Pegasus are session-specific, allowlist all cookies.
          {
            path: %w(
              /v2/*
              /v3/*
              /private*
            ) +
            # TODO: Collapse these paths into /private to simplify Pegasus caching config.
            %w(
              /amazon-future-engineer*
              /create-company-profile*
              /edit-company-profile*
              /review-hociyskvuwa*
              /manage-professional-development-workshops*
              /professional-development-workshop-surveys*
              /pd-program-registration*
              /poste*
            ),
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            path: '/dashboardapi/*',
            proxy: 'dashboard',
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            path: '/i18n/track_string_usage',
            proxy: 'dashboard',
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          # Cached paths that specifically filter query-parameters.
          {
            path: %w(
              /
            ),
            query: false,
            headers: ALLOWLISTED_HEADERS,
            cookies: default_cookies
          }
        ],
        # Remaining Pegasus paths are cached, and vary only on language, country, and default cookies.
        default: {
          headers: LANGUAGE_HEADER + COUNTRY_HEADER,
          cookies: default_cookies
        }
      },
      dashboard: {
        behaviors: [
          {
            # Serve Sprockets-bundled assets directly from the S3 bucket synced via `assets:precompile`.
            #
            path: '/assets/*',
            proxy: 'cdo-assets',
            headers: [],
            cookies: 'none'
          },
          {
            path: '/restricted/*',
            proxy: 'cdo-restricted',
            headers: [],
            cookies: 'none',
            trusted_signer: true,
          },
          {
            path: %w(
              /v3/assets/*
              /v3/animations/*
              /v3/files/*
              /v3/libraries/*
            ),
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            # Pass through cookies when requesting or deleting starter assets, as user authentication
            # is required when deleting assets.
            path: '/level_starter_assets/*',
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            # Pass through the user agent to the /api/user_progress and
            # /milestone actions so the activity monitor can track script
            # completion by user agent. These responses are never cached so this
            # won't hurt cachability.
            path: %w(
              /api/user_progress/*
              /milestone/*
            ),
            headers: ALLOWLISTED_HEADERS + ['User-Agent'],
            cookies: allowlisted_cookies
          },
          # Some script levels in cacheable scripts are project-backed and
          # should not be cached in CloudFront. Use CloudFront Behavior
          # precedence rules to not cache these paths, but all paths in
          # CACHED_UNITS_MAP that don't match this path will be cached.
          {
            path: UNCACHED_UNIT_LEVEL_PATHS,
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            path: CACHED_UNITS_MAP.values,
            headers: ALLOWLISTED_HEADERS,
            cookies: default_cookies
          },
          {
            path: '/api/v1/projects/gallery/public/*',
            headers: [],
            cookies: 'none'
          },
          {
            path: '/api/v1/sound-library/*',
            headers: [],
            cookies: 'none'
          },
          {
            path: '/api/*',
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            # For static-asset paths, don't forward any cookies or additional headers.
            path: STATIC_ASSET_EXTENSION_PATHS + %w(/blockly/media/* /media),
            headers: [],
            cookies: 'none'
          },
          {
            path: '/v2/*',
            proxy: 'pegasus',
            headers: ALLOWLISTED_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            path: %w(
              /v3/files-public/*
              /v3/sources-public/*
            ),
            headers: [],
            cookies: 'none'
          },
          {
            path: '/xhr*',
            headers: ALLOWLISTED_HEADERS + ALLOWED_WEB_REQUEST_HEADERS,
            cookies: allowlisted_cookies
          },
          {
            path: '/curriculum_tracking_pixel',
            headers: [],
            cookies: allowlisted_cookies
          }
        ],
        # Default Dashboard paths are session-specific, allowlist all session cookies and language header.
        default: {
          headers: ALLOWLISTED_HEADERS,
          cookies: allowlisted_cookies
        }
      }
    }
  end

  def self.uncached_script_level_path?(script_level_path)
    UNCACHED_UNIT_LEVEL_PATHS.include?(script_level_path)
  end

  # Return true if the levels for the given script name can be publicly cached by proxies.
  def self.allows_public_caching_for_script(script_name)
    CACHED_UNITS_MAP.include?(script_name)
  end
end
