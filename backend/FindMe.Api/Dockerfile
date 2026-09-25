FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY FindMe.Api.csproj ./
RUN dotnet restore ./FindMe.Api.csproj

COPY . ./
RUN dotnet publish ./FindMe.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish ./

EXPOSE 10000
ENTRYPOINT ["dotnet", "FindMe.Api.dll"]
