require_relative '../../deployment'
require 'cdo/chat_client'
require 'cdo/rake_utils'
require lib_dir 'cdo/data/logging/rake_task_event_logger'
include TimedTaskWithLogging

namespace :lint do
  desc 'Lints Ruby code with rubocop.'
  timed_task_with_logging :ruby do
    RakeUtils.bundle_exec 'rubocop', '--parallel'
  end

  desc 'Lints Haml code with haml-lint.'
  timed_task_with_logging :haml do
    RakeUtils.bundle_exec 'haml-lint dashboard pegasus'
  end

  desc 'Lints SCSS code with scss-lint.'
  timed_task_with_logging :scss do
    RakeUtils.bundle_exec 'scss-lint'
  end

  desc 'Lints JavaScript code.'
  timed_task_with_logging :javascript do
    Dir.chdir(apps_dir) do
      # The linter depends on eslint and its plugins, which are installed
      # as apps dependencies by yarn.  Ensure they are up-to-date before
      # linting.
      ChatClient.log 'Installing <b>apps</b> dependencies...'
      RakeUtils.npm_install

      ChatClient.log 'Linting <b>apps</b> JavaScript...'
      RakeUtils.system 'npm run lint'
    end
    Dir.chdir(shared_js_dir) do
      ChatClient.log 'Linting <b>shared</b> JavaScript...'
      # Use vanilla eslint parser, because babel-eslint always allows es6
      RakeUtils.system '../../apps/node_modules/eslint/bin/eslint.js *.js'
    end
  end

  timed_task_with_logging all: [:ruby, :haml, :scss, :javascript]
end
desc 'Lints all code.'
timed_task_with_logging lint: ['lint:all']
