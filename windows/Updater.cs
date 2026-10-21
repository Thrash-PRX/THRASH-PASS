using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("THRASH-PASS Updater")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

public static class Updates
{
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "THRASH-PASS");
    public static readonly string Extension = Path.Combine(Root, "extension");
    public static readonly string InstalledExe = Path.Combine(Root, "THRASH-PASS-Updater.exe");
    const string Metadata = "https://raw.githubusercontent.com/Thrash-PRX/THRASH-PASS/main/update.json";
    const string Archive = "https://codeload.github.com/Thrash-PRX/THRASH-PASS/zip/refs/heads/main";
    public static readonly string TaskName = "THRASH-PASS Updates " + WindowsIdentity.GetCurrent().User.Value;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    public static Version ReadVersion(string text)
    {
        Version version;
        if (!Version.TryParse(text.Trim().TrimStart('v'), out version) || version.Build < 0 || version.Revision > 0)
            throw new InvalidDataException("Invalid stable extension version.");
        return new Version(version.Major, version.Minor, version.Build, Math.Max(0, version.Revision));
    }

    public static string LocalVersion(string folder)
    {
        var path = Path.Combine(folder, "manifest.json");
        if (!File.Exists(path)) return "0.0.0";
        return Convert.ToString(Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path))["version"]);
    }

    // Fixed HTTPS destinations, bounded response size, no credentials or browser-profile access.
    public static byte[] Download(string url, int maximumBytes)
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.UserAgent = "THRASH-PASS-Updater/1.0";
        request.Timeout = 30000;
        request.ReadWriteTimeout = 30000;
        request.AllowAutoRedirect = false;
        request.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
        using (var response = request.GetResponse())
        using (var input = response.GetResponseStream())
        using (var output = new MemoryStream())
        {
            var buffer = new byte[16384];
            int count;
            while ((count = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (output.Length + count > maximumBytes) throw new InvalidDataException("Download exceeds the allowed size.");
                output.Write(buffer, 0, count);
            }
            return output.ToArray();
        }
    }

    public static void ExtractExtension(byte[] bytes, string stage, string expectedVersion)
    {
        Directory.CreateDirectory(stage);
        string prefix = null;
        long total = 0;
        using (var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read))
        {
            if (zip.Entries.Count > 4000) throw new InvalidDataException("Archive contains too many files.");
            foreach (var entry in zip.Entries)
            {
                if (entry.FullName.EndsWith("/extension/manifest.json", StringComparison.Ordinal))
                {
                    if (prefix != null) throw new InvalidDataException("Ambiguous extension package.");
                    prefix = entry.FullName.Substring(0, entry.FullName.Length - "manifest.json".Length);
                }
            }
            if (prefix == null) throw new InvalidDataException("Package is missing extension/manifest.json.");
            var stagePrefix = Path.GetFullPath(stage).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            foreach (var entry in zip.Entries)
            {
                if (!entry.FullName.StartsWith(prefix, StringComparison.Ordinal)) continue;
                var relative = entry.FullName.Substring(prefix.Length);
                if (relative.Length == 0) continue;
                if (relative.Contains(":") || relative.Contains("\\") || relative.Split('/').Length > 20)
                    throw new InvalidDataException("Unsafe archive path.");
                var target = Path.GetFullPath(Path.Combine(stage, relative.Replace('/', Path.DirectorySeparatorChar)));
                if (!target.StartsWith(stagePrefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Unsafe archive path.");
                if (entry.FullName.EndsWith("/", StringComparison.Ordinal)) { Directory.CreateDirectory(target); continue; }
                total += entry.Length;
                if (total > 64 * 1024 * 1024 || entry.Length > 16 * 1024 * 1024) throw new InvalidDataException("Extension package is too large.");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var input = entry.Open())
                using (var output = new FileStream(target, FileMode.CreateNew)) input.CopyTo(output);
            }
        }
        var manifest = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(stage, "manifest.json")));
        if (Convert.ToString(manifest["name"]) != "THRASH-PASS" || Convert.ToInt32(manifest["manifest_version"]) != 3 ||
            ReadVersion(LocalVersion(stage)) != ReadVersion(expectedVersion)) throw new InvalidDataException("Downloaded package does not match the advertised THRASH-PASS version. Try again later.");
        foreach (var required in new[] { "worker.js", "popup.html", "contentScript.js", "images/icon128.png" })
            if (!File.Exists(Path.Combine(stage, required))) throw new InvalidDataException("Package is missing " + required);
    }

    public static void Activate(string stage, string destination)
    {
        var backup = destination + ".previous";
        if (Directory.Exists(backup)) Directory.Delete(backup, true);
        bool existed = Directory.Exists(destination);
        if (existed) Directory.Move(destination, backup);
        try { Directory.Move(stage, destination); }
        catch { if (existed) Directory.Move(backup, destination); throw; }
        // Keep one previous build for manual recovery.
    }

    public static bool Check()
    {
        Directory.CreateDirectory(Root);
        bool acquired;
        using (var mutex = new Mutex(true, "Local\\THRASH-PASS-" + WindowsIdentity.GetCurrent().User.Value, out acquired))
        {
            if (!acquired) throw new InvalidOperationException("Another THRASH-PASS update is already running.");
            try
            {
                var info = Json.Deserialize<Dictionary<string, object>>(System.Text.Encoding.UTF8.GetString(Download(Metadata, 32768)));
                var latest = Convert.ToString(info["version"]);
                if (ReadVersion(latest) <= ReadVersion(LocalVersion(Extension))) return false;
                var stage = Path.Combine(Root, "staging-" + Guid.NewGuid().ToString("N"));
                try
                {
                    ExtractExtension(Download(Archive, 128 * 1024 * 1024), stage, latest);
                    Activate(stage, Extension);
                    Log("Installed extension " + latest + ". Reload it in chrome://extensions.");
                    return true;
                }
                finally { if (Directory.Exists(stage)) Directory.Delete(stage, true); }
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    public static void Log(string message)
    {
        Directory.CreateDirectory(Root);
        var log = Path.Combine(Root, "updater.log");
        if (File.Exists(log) && new FileInfo(log).Length > 256 * 1024) File.Delete(log);
        File.AppendAllText(log, DateTime.UtcNow.ToString("u") + " " + message + Environment.NewLine);
    }

    public static void Schedule(bool enable)
    {
        if (enable)
        {
            Directory.CreateDirectory(Root);
            var source = Application.ExecutablePath;
            if (!String.Equals(Path.GetFullPath(source), InstalledExe, StringComparison.OrdinalIgnoreCase)) File.Copy(source, InstalledExe, true);
        }
        var args = enable
            ? "/Create /F /SC HOURLY /MO 6 /RL LIMITED /IT /TN \"" + TaskName + "\" /TR \"\\\"" + InstalledExe + "\\\" --background\""
            : "/Delete /F /TN \"" + TaskName + "\"";
        var start = new ProcessStartInfo("schtasks.exe", args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        using (var process = Process.Start(start))
        {
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException("Windows could not change the update schedule. " + output + error);
        }
    }
}

public class UpdaterWindow : Form
{
    readonly Label status = new Label { AutoSize = false, Height = 190, Dock = DockStyle.Top };
    readonly Button install = new Button { Text = "Install / update and enable automatic checks", Width = 430, Height = 42 };
    public UpdaterWindow()
    {
        Text = "THRASH-PASS Updater";
        ClientSize = new Size(550, 440); Padding = new Padding(24); StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        BackColor = Color.FromArgb(16, 18, 22); ForeColor = Color.White; Font = new Font("Segoe UI", 10);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        status.Text = "THRASH-PASS for Windows\n\nAutomatic file updates every six hours while signed in.\nAfter an update, reload THRASH-PASS in chrome://extensions.\nFirst install: enable Developer mode and Load unpacked.";
        Controls.Add(status);
        var panel = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 175, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        Controls.Add(panel);
        panel.Controls.Add(install);
        install.BackColor = Color.FromArgb(216, 255, 86); install.ForeColor = Color.Black;
        install.Click += async delegate {
            install.Enabled = false; status.Text = "Checking the official repository and downloading if needed...";
            try
            {
                bool changed = await Task.Run(() => Updates.Check());
                Updates.Schedule(true);
                status.Text = (changed ? "Installed version " : "Already up to date: ") + Updates.LocalVersion(Updates.Extension) +
                    ". Automatic checks enabled.\n\nLoad this folder once using Load unpacked:\n" + Updates.Extension + "\n\nAfter later updates: click Reload in chrome://extensions.";
            }
            catch (Exception error) { status.Text = "Could not finish: " + error.Message; }
            finally { install.Enabled = true; }
        };
        AddButton(panel, "Open extension folder", delegate { Directory.CreateDirectory(Updates.Extension); Process.Start("explorer.exe", "\"" + Updates.Extension + "\""); });
        AddButton(panel, "Copy chrome://extensions", delegate { Clipboard.SetText("chrome://extensions"); status.Text = "Paste chrome://extensions into Chrome's address bar.\n\nFirst install: enable Developer mode, click Load unpacked, and select:\n" + Updates.Extension + "\n\nExisting installation: click Reload after an update."; });
        AddButton(panel, "Disable automatic checks", delegate { Updates.Schedule(false); status.Text = "Automatic checks disabled. Your extension files and settings are kept."; });
    }
    void AddButton(FlowLayoutPanel panel, string label, Action action)
    {
        var button = new Button { Text = label, Width = 430, Height = 32, BackColor = Color.FromArgb(40, 45, 52), ForeColor = Color.White };
        button.Click += delegate { try { action(); } catch (Exception error) { status.Text = error.Message; } };
        panel.Controls.Add(button);
    }
}

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (Array.IndexOf(args, "--background") >= 0)
        {
            try
            {
                if (Updates.Check())
                {
                    using (var icon = new NotifyIcon { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath), Visible = true, Text = "THRASH-PASS" })
                    {
                        icon.BalloonTipClicked += delegate { Process.Start(Updates.InstalledExe); };
                        icon.ShowBalloonTip(8000, "THRASH-PASS updated", "New files are ready. Reload THRASH-PASS in chrome://extensions.", ToolTipIcon.Info);
                        var timer = new System.Windows.Forms.Timer { Interval = 10000 };
                        timer.Tick += delegate { timer.Stop(); Application.ExitThread(); };
                        timer.Start(); Application.Run(); timer.Dispose();
                    }
                }
                return 0;
            }
            catch (Exception error) { try { Updates.Log("Update failed: " + error.Message); } catch { } return 1; }
        }
        Application.Run(new UpdaterWindow());
        return 0;
    }
}
