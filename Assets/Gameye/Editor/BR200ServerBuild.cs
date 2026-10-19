using System;
using System.IO;
using System.Linq;
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
                scenes = scenes
            };
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(output), "server-build-report.json"), JsonUtility.ToJson(evidence, true));
            Debug.Log($"BR200_SERVER_BUILD target={evidence.target} subtarget={evidence.subtarget} backend={evidence.backend} result={evidence.result}");
            EditorApplication.Exit(report.summary.result == BuildResult.Succeeded && subtarget == StandaloneBuildSubtarget.Server ? 0 : 1);
        }

        [Serializable]
        private sealed class ServerBuildEvidence
        {
            public string editor, target, subtarget, backend, result;
            public int errors, warnings;
            public ulong bytes;
            public double seconds;
            public string[] scenes;
        }
    }
}
