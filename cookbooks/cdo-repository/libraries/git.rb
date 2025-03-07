# Extends the base Chef Git Provider to provide the following extra features:
# - Better shallow-clone support:
#   - Support single-branch shallow-clones using the `depth` parameter.
#   - Checkout branch at clone-time to avoid separate checkout step.
#   - Narrowly expand the fetch references in the git config to a shallow when switching to a new branch.

# - Better branch names:
#   - Set checkout branch to remote track the corresponding remote branch with the same name.
#   - Support switching to a new checkout branch after the initial clone.
module Cdo
  module Provider
    class Git < Chef::Provider::Git
      def initialize(new_resource, run_context)
        super new_resource, run_context
        # `checkout_branch` is always `false`, since this provider always skips the extra checkout step.
        new_resource.enable_checkout false
      end

      def clone
        converge_by("clone from #{@new_resource.repository} into #{@new_resource.destination}") do
          remote = @new_resource.remote

          args = ["clone"]
          args << "-o #{remote}" unless remote == "origin"
          args << "--depth #{@new_resource.depth}" if @new_resource.depth
          # PATCH: Use --branch to checkout at clone time to avoid separate checkout step.
          args << "--branch #{@new_resource.checkout_branch}" unless @new_resource.enable_checkout
          # PATCH: Remove --no-single-branch to support shallow-clones.
          # args << "--no-single-branch" if @new_resource.depth and git_minor_version >= Gem::Version.new("1.7.10")
          args << @new_resource.repository.inspect
          args << @new_resource.destination.inspect

          Chef::Log.info "#{@new_resource} cloning repo #{@new_resource.repository} to #{@new_resource.destination}"
          git(args)
        end
      end

      def fetch_updates
        setup_remote_tracking_branches(@new_resource.remote, @new_resource.repository)
        update_fetch_refs
        run_opts = {cwd: @new_resource.destination}
        # PATCH: support shallow fetch.
        converge_by("fetch updates for #{@new_resource.remote}") do
          git("fetch #{@new_resource.remote}", **run_opts)
        end
        # PATCH: support switching to a new checkout branch after the initial clone.
        if @new_resource.checkout_branch != current_branch
          converge_by "Checking out branch #{@new_resource.checkout_branch}" do
            git("checkout #{@new_resource.checkout_branch}", **run_opts)
          end
        end
        # since we're in a local branch already, just reset to specified revision rather than merge
        converge_by "Resetting to revision #{target_revision}" do
          git("reset --hard #{target_revision}", **run_opts)
        end
      end

      def current_branch
        git('rev-parse --abbrev-ref HEAD', cwd: @new_resource.destination).stdout
      end

      # PATCH: Expand the remote.origin.fetch config to include the specified branch if needed.
      def update_fetch_refs
        branch = @new_resource.checkout_branch
        remote = @new_resource.remote
        cwd = @new_resource.destination

        # Skip update if either the exact or wildcard fetch-ref already exists in the config.
        ref_exists = [
          "config --get remote.#{remote}.fetch '^\\+refs/heads/#{branch}:refs/remotes/#{remote}/#{branch}$'",
          "config --get remote.#{remote}.fetch '^\\+refs/heads/\*:refs/remotes/#{remote}/\*$'"
        ].any? do |cmd|
          git(cmd, cwd: cwd, returns: [0, 1]).exitstatus == 0
        end

        unless ref_exists
          converge_by("Updating fetch refs for #{remote}/#{branch}") do
            git("config --add remote.#{remote}.fetch +refs/heads/#{branch}:refs/remotes/#{remote}/#{branch}", cwd: cwd)
          end
        end
      end
    end
  end
end
