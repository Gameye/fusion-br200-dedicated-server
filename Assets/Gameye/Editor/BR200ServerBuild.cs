using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Gameye.Editor
{
    public static class BR200ServerBuild
    {
        public static void Build()
        {
            string[] args = Environment.GetCommandLineArgs();
            int outputIndex = Array.IndexOf(args, "-buildOutput");
            if (outputIndex < 0 || outputIndex + 1 >= args.Length)
                throw new BuildFailedException("Pass the output executable using Unity CLI --output-path.");

            string output = Path.GetFullPath(args[outputIndex + 1]);
            string[] scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray();
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            EditorUserBuildSettings.standaloneBuildSubtarget = StandaloneBuildSubtarget.Server;

            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = output,
                target = BuildTarget.StandaloneLinux64,
                subtarget = (int)StandaloneBuildSubtarget.Server,
                options = BuildOptions.None
            });

            StandaloneBuildSubtarget subtarget = report.summary.GetSubtarget<StandaloneBuildSubtarget>();
            var evidence = new ServerBuildEvidence
            {
                editor = Application.unityVersion,
                target = report.summary.platform.ToString(),
                subtarget = subtarget.ToString(),
                backend = PlayerSettings.GetScriptingBackend(NamedBuildTarget.Server).ToString(),
                result = report.summary.result.ToString(),
                errors = report.summary.totalErrors,
                warnings = report.summary.totalWarnings,
                bytes = report.summary.totalSize,
                seconds = report.summary.totalTime.TotalSeconds,
                scenes = scenes,
                manifestSha256 = ManifestSha256(Path.GetDirectoryName(output))
            };
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(output), "server-build-report.json"), JsonUtility.ToJson(evidence, true));
            Debug.Log($"BR200_SERVER_BUILD target={evidence.target} subtarget={evidence.subtarget} backend={evidence.backend} result={evidence.result}");
            EditorApplication.Exit(report.summary.result == BuildResult.Succeeded && subtarget == StandaloneBuildSubtarget.Server ? 0 : 1);
        }

        // One hash over every file that ships, so packaging can tell this build's files from a
        // stale or mixed folder. It skips what .dockerignore skips: top-level *.json and Unity's
        // don't-ship folders. scripts/docker-build-server.sh computes the same value.
        private static string ManifestSha256(string root)
        {
            string[] files = Directory.GetFiles(root, "*", SearchOption.AllDirectories)
                .Select(path => Path.GetRelativePath(root, path).Replace('\\', '/'))
                .Where(Ships)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            var manifest = new StringBuilder();
            using (SHA256 sha = SHA256.Create())
            {
                foreach (string path in files)
                {
                    using (FileStream stream = File.OpenRead(Path.Combine(root, path)))
                        manifest.Append(Hex(sha.ComputeHash(stream))).Append("  ").Append(path).Append('\n');
                }
                return Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(manifest.ToString())));
            }
        }

        private static bool Ships(string path)
        {
            int slash = path.IndexOf('/');
            if (slash < 0) return !path.EndsWith(".json", StringComparison.Ordinal);
            string top = path.Substring(0, slash);
            return !top.EndsWith("BackUpThisFolder_ButDontShipItWithYourGame", StringComparison.Ordinal)
                && !top.EndsWith("BurstDebugInformation_DoNotShip", StringComparison.Ordinal);
        }

        private static string Hex(byte[] bytes) => BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();

        [Serializable]
        private sealed class ServerBuildEvidence
        {
            public string editor, target, subtarget, backend, result, manifestSha256;
            public int errors, warnings;
            public ulong bytes;
            public double seconds;
            public string[] scenes;
        }
    }
}
