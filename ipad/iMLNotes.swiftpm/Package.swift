// swift-tools-version: 5.9
// App Playground 形式的 iPad 应用：Xcode 15+ 可直接打开运行，也可以在 iPad 的 Swift Playgrounds 里打开。
// 如需要正式的 .xcodeproj，用 Xcode 新建 "App" 工程后把本目录下的 .swift 文件拖进去即可，无其他依赖。
import PackageDescription
import AppleProductTypes

let package = Package(
    name: "iMLNotes",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "iML Notes",
            targets: ["AppModule"],
            bundleIdentifier: "com.imoling.imlnotes",
            teamIdentifier: "",
            displayVersion: "26.1",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .pencil),
            accentColor: .presetColor(.indigo),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            appCategory: .productivity
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: "."
        )
    ]
)
