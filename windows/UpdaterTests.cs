using System;
using System.IO;
using System.IO.Compression;
using System.Text;

public static class UpdaterTests
{
    static int assertions;
    static void Assert(bool success, string reason) { assertions++; if (!success) throw new Exception(reason); }
    static byte[] Package(string extra, string version)
    {
        using (var memory = new MemoryStream())
        {
            using (var zip = new ZipArchive(memory, ZipArchiveMode.Create, true))
            {
                string root = "THRASH-PASS-main/extension/";
                using (var writer = new StreamWriter(zip.CreateEntry(root + "manifest.json").Open()))
                    writer.Write("{\"name\":\"THRASH-PASS\",\"manifest_version\":3,\"version\":\"" + version + "\"}");
                foreach (var file in new[] { "worker.js", "popup.html", "contentScript.js", "images/icon128.png", extra })
                    using (var writer = new StreamWriter(zip.CreateEntry(root + file).Open())) writer.Write("test content");
            }
            return memory.ToArray();
        }
    }
    public static int Main(string[] args)
    {
        string root = Path.Combine(Path.GetTempPath(), "thrash-pass-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Assert(Updates.ReadVersion("2.10.0") > Updates.ReadVersion("2.9.0"), "Numeric version comparison");
            Assert(Updates.ReadVersion("v2.2.0") == Updates.ReadVersion("2.2.0"), "Version prefix normalization");
            bool invalid = false;
            try { Updates.ReadVersion("not-a-version"); } catch (InvalidDataException) { invalid = true; }
            Assert(invalid, "Invalid metadata rejected");
            string stage = Path.Combine(root, "stage");
            Updates.ExtractExtension(Package("settings.js", "2.2.0"), stage, "2.2.0");
            Assert(File.Exists(Path.Combine(stage, "worker.js")), "Valid package extracted");
            Assert(!Directory.Exists(Path.Combine(stage, "docs")), "Only extension files extracted");
            string target = Path.Combine(root, "extension");
            Directory.CreateDirectory(target); File.WriteAllText(Path.Combine(target, "old"), "previous");
            Updates.Activate(stage, target);
            Assert(File.Exists(Path.Combine(target, "manifest.json")), "Staged build activated");
            Assert(File.Exists(Path.Combine(target + ".previous", "old")), "Previous build preserved");
            string failure = Path.Combine(root, "failed");
            Directory.CreateDirectory(failure); File.WriteAllText(Path.Combine(failure, "old"), "restore me");
            try { Updates.Activate(Path.Combine(root, "missing-stage"), failure); } catch (DirectoryNotFoundException) { }
            Assert(File.Exists(Path.Combine(failure, "old")), "Failed activation restores previous build");
            foreach (string path in new[] { "../escaped.txt", "C:/escaped.txt", "..\\escaped.txt" })
            {
                bool rejected = false;
                try { Updates.ExtractExtension(Package(path, "2.2.0"), Path.Combine(root, Guid.NewGuid().ToString("N")), "2.2.0"); }
                catch (InvalidDataException) { rejected = true; }
                Assert(rejected, "Unsafe archive path rejected: " + path);
            }
            bool mismatch = false;
            try { Updates.ExtractExtension(Package("settings.js", "2.2.1"), Path.Combine(root, "mismatch"), "2.2.0"); }
            catch (InvalidDataException) { mismatch = true; }
            Assert(mismatch, "Version race rejected before activation");
            if (Array.IndexOf(args, "--live-download") >= 0)
            {
                var metadata = Updates.Download("https://raw.githubusercontent.com/Thrash-PRX/THRASH-PASS/main/update.json", 32768);
                var info = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(Encoding.UTF8.GetString(metadata));
                string latest = Convert.ToString(info["version"]);
                var live = Updates.Download("https://codeload.github.com/Thrash-PRX/THRASH-PASS/zip/refs/heads/main", 128 * 1024 * 1024);
                Updates.ExtractExtension(live, Path.Combine(root, "live"), latest);
                Assert(File.Exists(Path.Combine(root, "live", "settings.js")), "Live GitHub archive validated");
                Assert(Updates.ReadVersion(latest).Major >= 2, "Live metadata endpoint reachable");
            }
            Console.WriteLine("PASS: " + assertions + " Windows updater assertions. No tasks or installed files changed.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Directory.Delete(root, true); }
    }
}
