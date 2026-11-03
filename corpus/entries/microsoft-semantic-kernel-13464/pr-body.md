### Motivation and Context

Addresses a gap in the SK → Agent Framework migration guide for scenarios where tools are added to the kernel after it's already built via `kernel.Plugins.Add()`. Referenced from [microsoft/agent-framework#3276](https://github.com/microsoft/agent-framework/issues/3276#issuecomment-3777591036).

### Description

Adds a "Runtime Tool Registration Transformation" section to `SemanticKernelToAgentFramework.md` showing the middleware pattern for dynamic tool registration.

**Semantic Kernel pattern:**
```csharp
Kernel kernel = kernelBuilder.Build();
ChatCompletionAgent agent = new() { Kernel = kernel };

// Later: add tools post-creation
KernelFunction function = KernelFunctionFactory.CreateFromMethod(GetWeather);
KernelPlugin plugin = KernelPluginFactory.CreateFromFunctions("WeatherPlugin", [function]);
kernel.Plugins.Add(plugin);
```

**Agent Framework equivalent:**
```csharp
var augmentedAgent = existingAgent.AsBuilder()
    .Use(async (chatMessages, agentThread, agentRunOptions, next, cancellationToken) =>
    {
        if (agentRunOptions is ChatClientAgentRunOptions opts)
        {
            opts.ChatOptions ??= new ChatOptions();
            opts.ChatOptions.Tools ??= [];
            opts.ChatOptions.Tools.Add(AIFunctionFactory.Create(GetWeather));
        }
        return await next(chatMessages, agentThread, agentRunOptions, cancellationToken);
    })
    .Build();
```

This middleware approach creates a dedicated augmented agent instance without disrupting existing usages.

### Contribution Checklist

- [x] The code builds clean without any errors or warnings
- [x] The PR follows the [SK Contribution Guidelines](https://github.com/microsoft/semantic-kernel/blob/main/CONTRIBUTING.md) and the [pre-submission formatting script](https://github.com/microsoft/semantic-kernel/blob/main/CONTRIBUTING.md#development-scripts) raises no violations
- [x] All unit tests pass, and I have added new tests where possible
- [x] I didn't break anyone :smile:





<details>

<summary>Original prompt</summary>

> On SemanticKernelToAgentFramework.md, I got this valuable issue and I think worth adding a small piece of example in the migration when any tool is being added to the agent/kernel via instance level, providing the path suggested in the issue as a solution, mainly the option 1 provided by rogerbarreto.
> 
> https://github.com/microsoft/agent-framework/issues/3276


</details>




---

💡 You can make Copilot smarter by setting up custom instructions, customizing its development environment and configuring Model Context Protocol (MCP) servers. Learn more [Copilot coding agent tips](https://gh.io/copilot-coding-agent-tips) in the docs.
